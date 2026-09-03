# Performance Strategy

## Principles

Performance work should be measurable. Do not claim improvements or metrics without evidence from tests, logs, browser tools, or database analysis.

## API Performance

- Paginate all list endpoints.
- Add indexes for common filters and sorts.
- Keep response payloads narrow.
- Avoid unbounded includes and N+1 query patterns.
- Use Prisma `select` deliberately.
- Use transactions only where consistency requires them.

### Measured (Milestone 12)

Every list endpoint now paginates via one shared contract
(`@aisbp/shared/pagination`). `EXPLAIN (ANALYZE, BUFFERS)` on ~3,000 seeded
bookings showed all list queries running sub-millisecond on the existing
indexes; **no index was added**. The query plans and the deferred
`Booking(status, createdAt)` composite (with its trigger condition) are recorded
in [Database](database.md#search-filtering--pagination-performance-milestone-12).

Important indexed access patterns:

- services by active status, category, and slug
- bookings by customer, technician, status, and scheduled date
- availability slots by service, technician, status, and start time
- status history by booking and creation time

## Frontend Performance

- Use route-level code splitting where practical.
- Debounce search and filter inputs.
- Keep large lists paginated.
- Avoid global Redux state for local form state.
- Use memoization only for measured or obvious render hotspots.
- Keep accessible loading and empty states for async views.

## Redis Usage

Redis is approved but should be used deliberately.

Good MVP uses:

- server-side sessions
- auth and AI rate limiting
- short-lived caching for hot read-heavy queries if measured need appears

Avoid using Redis as a second source of truth for booking or availability state.

### Measured — catalogue cache (Milestone 13)

A read-through cache (`apps/api/src/lib/cache.ts`) was added to the three public
catalogue endpoints only. Measured at the service layer against the seeded
database (13 active services), Node 22 / PostgreSQL 14 / Redis 5, all on
localhost, mean of 200 iterations:

| Call                                 | Cache miss (cold)  | Cache hit (warm) | PostgreSQL queries                                 |
| ------------------------------------ | ------------------ | ---------------- | -------------------------------------------------- |
| `listServices` (no `q`)              | ~10 ms (p50 7.8)   | **1.8 ms**       | miss 1 (`findMany`+`count` in one txn) → hit **0** |
| `getServiceBySlug`                   | ~6 ms              | **1.2 ms**       | miss 1 → hit **0**                                 |
| `listCategories`                     | ~5.4 ms            | **1.4 ms**       | miss 1 → hit **0**                                 |
| `listServices` (`?q=wifi`, uncached) | ~6.9 ms every call | n/a              | 1 every call                                       |

A cache hit is one Redis `GET` and zero database round-trips; a miss adds the
`SET`. End-to-end over Express/supertest the two are within HTTP-overhead noise
(~13 ms both) on this single-box setup — the ~4–6× data-layer win becomes
material only under real load or with Redis/PostgreSQL off-box. TTL is 120 s;
there is no cache stampede protection (concurrent cold misses each run the
sub-millisecond query once — acceptable per the Milestone 12 query-plan work).
Pricing and availability were evaluated and left uncached (see
[API Boundaries](api.md#caching-milestone-13)).

## Availability Performance

Availability queries are likely to be performance-sensitive. They should use indexed date ranges and service filters. Slot reservation must remain transaction-safe in PostgreSQL even if read queries are cached later.

## AI Performance

- Claude calls should have server-side timeouts.
- AI endpoints should support safe fallback when provider calls fail.
- Do not block normal booking flows on AI unless the user is explicitly using the AI assistant.
- Cache only non-sensitive, stable context such as active service catalog summaries if useful.

### Implemented (Milestone 14)

- The Claude client (`apps/api/src/lib/claude.ts`) sets a server-side timeout
  (`AI_REQUEST_TIMEOUT_MS`, default 15s) and `maxRetries: 1`.
- The assistant is **off the critical path**: it lives on its own
  `/api/v1/ai/booking-assistant/*` routes; the catalogue, availability, pricing,
  and booking flows never call Claude.
- Every AI path has a non-AI fallback: `intent` / `clarify` return a
  clarification on any Claude error (no retry storm, no 5xx); `availability`
  returns real slots with a templated summary.
- A per-user Redis rate limit (`AI_RATE_LIMIT_MAX`) caps cost and load.
- The prompt reuses the cached catalogue list (Milestone 13) for its service
  context, so the grounding read is usually a cache hit.
- No latency benchmark is recorded here — real Claude calls are not made in CI
  or the local test environment (the tests inject a fake client). Measure
  against a real key before tuning the model or `max_tokens`.

## Measured — Milestone 16

Evidence-based review. Synthetic dataset loaded into the local PostgreSQL 14
(`scratchpad/m16-perf*.sql`, cleaned up after): **30 000 bookings**, **20 000
customers + addresses**, **60 technicians**, **37 000 availability slots**,
**55 000 status-history rows**. `EXPLAIN (ANALYZE, BUFFERS)`, warm cache.

| Path                                    | Query shape                                               | Plan                                                                               | Time         | Conclusion                                                                      |
| --------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------- |
| Public catalogue list                   | `Service` where `active`, `name` sort, `LIMIT 12`         | Seq Scan (13 rows) → sort                                                          | **0.16 ms**  | trivial; table is tiny by design                                                |
| Pricing quote                           | `Service` where `slug = ? AND active`                     | Index Scan `Service_slug_key`                                                      | **0.08 ms**  | indexed point read                                                              |
| Public availability (normal)            | slots for a service, 14-day window                        | Index Scan `AvailabilitySlot_status_startsAt_idx` + `Booking` anti-join (Seq Scan) | **~20 ms**   | dominated by the `booking IS NULL` anti-join over the bookings table            |
| Public availability (slot flood)        | same, 12 500 available slots for one service              | Seq Scan slots + **nested-loop join, bad row estimate**                            | **88 ms**    | root cause: no minimum slot length → fixed by `SLOT_MIN_MINUTES` + `LIMIT 250`  |
| Customer booking list                   | `customerId = ? [+ status]`, `createdAt` sort, `LIMIT 10` | Index Scan `Booking_customerId_createdAt_idx`                                      | **0.12 ms**  | one customer's rows are naturally bounded                                       |
| Customer booking `count`                | same filter                                               | Index Scan `Booking_customerId_createdAt_idx`                                      | **0.07 ms**  | —                                                                               |
| Technician jobs list                    | `technicianId = ? + status`, `scheduledStart` sort        | Incremental Sort on `Booking_technicianId_scheduledStart_idx`                      | **0.28 ms**  | —                                                                               |
| Operations queue (status filter)        | `status = ?`, `createdAt` sort, `LIMIT 20`                | Bitmap Index Scan `Booking_status_idx` → top-N heapsort                            | **7.5 ms**   | acceptable; index-backed                                                        |
| Operations queue (no filter)            | `createdAt` sort, `LIMIT 20`                              | Seq Scan (30k) → top-N heapsort                                                    | **31 ms**    | full scan; deferred `Booking(status, createdAt)` would help — not yet necessary |
| Operations queue `count` (status)       | `status = ?`                                              | Bitmap Index Scan `Booking_status_idx`                                             | **3.6 ms**   | —                                                                               |
| Deep pagination                         | operations queue, `OFFSET 199 980` (`page=10000`)         | Seq Scan + full quicksort of 30k rows                                              | **206 ms**   | fixed: `PAGE_MAX` lowered to 1 000                                              |
| Dashboard `groupBy status`              | full-table group                                          | Seq Scan (30k) + HashAggregate                                                     | **26–31 ms** | full scan; unavoidable for an un-filtered group; deferred                       |
| Dashboard total `count(*)`              | —                                                         | Seq Scan (30k)                                                                     | **11–15 ms** | deferred                                                                        |
| Operations `q` search                   | `customer.name / email ILIKE '%…%'` (join)                | Hash Join + **Seq Scan `User` (20k)**                                              | **122 ms**   | operations-only; deferred `pg_trgm` GIN (M12 plan)                              |
| Technician list `activeAssignmentCount` | `groupBy technicianId` over 20 ids                        | one `groupBy`, not per row                                                         | fast         | **no N+1**                                                                      |

### N+1 / query-count audit

Every list endpoint issues a fixed number of queries independent of row count:

| Endpoint                                                     | Queries                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `GET /api/v1/services`                                       | 1 (`$transaction([findMany, count])`) + optional cache                    |
| `GET /api/v1/bookings`, `GET /api/v1/technician/bookings`    | 2 (`findMany` + `count`)                                                  |
| `GET /api/v1/operations/bookings`                            | 2                                                                         |
| `GET /api/v1/operations/technicians`                         | 3 (`findMany` + `count` + one `groupBy` for all rows' assignment counts)  |
| `GET /api/v1/operations/bookings/:id/assignable-technicians` | 3 (booking + technicians + one batched `IN` overlap query)                |
| `GET /api/v1/operations/dashboard`                           | 7 parallel aggregations, never a row load                                 |
| AI `intent` / `clarify` context                              | ≤ 2 (`Promise.all` of the cached catalogue list + `addresses.listByUser`) |

Related data (`service`, `customer`, `technician`, `address`, `statusHistory`)
is always fetched with a nested `select` (one join), never per row. **No N+1
was found.** Query-count assertions are not added to the suite — the Prisma
client is not instrumented for query events, and the counts above are visible
in the repository code and confirmed by the plans; the bounded-pagination and
availability-cap behaviours _are_ covered by regression tests.

### Fixes and their effect

| Fix                                             | Before                                                                                     | After                                                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SLOT_MIN_MINUTES = 15`                         | a technician can create ~89 000 1-minute slots in 62 days                                  | ~4/hour ceiling — realistic technicians have tens of slots                                                                                                                    |
| `AVAILABILITY_PUBLIC_MAX_SLOTS = 250` (`LIMIT`) | availability response and sort scale with total slot count (88 ms / 12.5k rows at a flood) | sort is a bounded top-N heapsort, payload ≤ 250 rows (75 ms at the same flood; the join is still O(matching slots), bounded by the slot floor at realistic technician counts) |
| `PAGE_MAX` 10 000 → 1 000                       | `page=10000` → 206 ms full sort                                                            | `page` beyond 1 000 → `422`; no realistic UI is affected                                                                                                                      |

### Frontend bundle

Production build (`pnpm build`): `dist/assets/index-*.js` ≈ **460 kB** raw /
**132 kB** gzip, one chunk; `index-*.css` ≈ 25 kB / 5.8 kB gzip. Acceptable for
an MVP SPA; route-level code splitting is a documented future improvement, not
an M16 fix.

## Measurement Plan

As implementation matures, collect:

- API latency for core endpoints
- query plans for booking and availability endpoints
- frontend bundle size
- Playwright smoke test duration
- AI provider latency and validation failure rate
