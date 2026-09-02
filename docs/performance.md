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

## Measurement Plan

As implementation matures, collect:

- API latency for core endpoints
- query plans for booking and availability endpoints
- frontend bundle size
- Playwright smoke test duration
- AI provider latency and validation failure rate
