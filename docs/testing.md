# Testing Strategy

This describes the testing setup **as implemented** (Milestone 15). Three
layers, each responsible for a different kind of guarantee:

| Layer           | Runner                           | What it proves                                                                     | Where                                                                       |
| --------------- | -------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Unit**        | Vitest                           | Pure domain/contract logic — no I/O                                                | `packages/shared/src/*.test.ts`, a few in `apps/*`                          |
| **Integration** | Vitest + real PostgreSQL + Redis | HTTP behaviour through the real stack: auth, DTO shape, DB invariants, concurrency | `apps/api/src/**/*.integration.test.ts`, `packages/database/src/__tests__/` |
| **Component**   | Vitest + jsdom + Testing Library | React route/form behaviour with `fetch` mocked                                     | `apps/web/src/**/*.test.tsx`                                                |
| **E2E**         | Playwright (Chromium)            | Whole user journeys against the built web + API + real DB/Redis                    | `apps/e2e/tests/*.spec.ts`                                                  |

Run everything the way CI does:

```bash
pnpm test          # unit + integration + component (all Vitest packages)
pnpm test:coverage # the same, with a V8 coverage summary
pnpm test:e2e      # Playwright — builds web+API, starts them, drives Chromium
```

## Boundaries the tests respect

The house layering is `route → middleware/auth → controller → service →
repository → Prisma → PostgreSQL`. Tests exercise it from the outside:

- **Unit tests** never touch a network, a database, or Redis. They cover pure
  functions and Zod contracts only.
- **Integration tests** hit real HTTP endpoints (`supertest`) against a real
  migrated + seeded PostgreSQL and a real Redis. Repositories and services are
  **not** mocked — the point is to prove the real path, including transactions
  and database constraints.
- The **only** external dependency that is faked is the Claude API (see below).
- **E2E tests** are black-box: they drive the browser and, for setup only, call
  the real API (`request` fixture) or — where the integration suites already
  establish the pattern — the `@aisbp/database/testing` Prisma handle.

## Unit test focus (implemented)

`packages/shared` is almost entirely pure and is the densest unit target:

- **pricing** — `calculateServicePrice`: integer-cent arithmetic, the
  `total = subtotal + fees + tax − discount` invariant, `RangeError` on a bad base price.
- **pagination** — `pageParams` bounds (`422`, no clamping), `paginationMeta`
  boundary flags and page-past-end, `pageOffset`.
- **booking state machine** — the transition table matches the docs exactly;
  `canTransition` / `canActorTransition` accept documented transitions and
  reject every other pair; `isCustomerCancellable`; every status value is
  covered.
- **AI intent** — `aiBookingIntentSchema` accept/reject (bad date, bad enum,
  missing field, nulls); `missingIntentFields` deterministic output; the
  `.strict()` request bodies; slug-shape validation.
- **availability** — `checkSlotTimes` (end-before-start, > 12 h, past / exactly
  now, > 365 days ahead, exact-limit boundary); `durationMinutes` rounding;
  `createSlotSchema` accept + mass-assignment rejection.
- **catalogue** — `formatPrice` (currency + unknown-code fallback),
  `formatDuration`, `catalogueQuerySchema` bounds and unknown-key tolerance.
- **address** — `countrySchema` normalisation, `createAddressSchema` bounds /
  `line2` → `null` / `.strict()`, `updateAddressSchema` non-empty rule,
  `formatAddress`.
- **operations / technician** contracts — query and mutation-body schemas.

## Integration test focus (implemented)

Real PostgreSQL + Redis. Each suite cleans up the rows it creates
(`authtest-` / fixture-prefixed) and flushes its Redis logical DB where the
behaviour depends on Redis.

- **auth** (`auth.integration.test.ts`) — register / login / logout / `me`;
  session fixation; the password hash never leaves; per-IP + per-email rate
  limiting; generic `401` for unknown email vs wrong password.
- **authorization** (`authorization.integration.test.ts`) — `requireRole`
  multi-role gates; `requireResourceOwner` returns `404` (not `403`) for a
  cross-owner resource; operations may reach any resource.
- **catalogue** — categories / services; search, filter, sort, pagination;
  inactive-service `404`; the Redis cache (`catalogue.cache.integration.test.ts`:
  first request from PostgreSQL then Redis, distinct key per query, `q` never
  cached, `404` never cached, malformed request creates no key, deactivation
  window). Cache **failure fallback** is covered at the boundary in
  `cache.test.ts` (a dead-port client → the read falls through, no 5xx).
- **addresses** — customer CRUD; per-row ownership / IDOR (`404`, not `403`);
  `.strict()` bodies; deleting a booking-referenced address → `409`.
- **availability** — valid creation; invalid ranges; past-slot rejection; the
  PostgreSQL exclusion constraint as the overlap authority (including two
  concurrent overlapping creates); technician-only access.
- **pricing** — the live quote; integer-cent output; `422` malformed slug /
  `404` unknown / `404` inactive; the quote tracks `Service.basePriceCents`.
- **bookings** — creation in one transaction; the immutable price snapshot;
  initial `pending` + history row; customer ownership / IDOR; cancellation and
  invalid-transition `409`; **double-booking: two concurrent creates for one
  slot yield exactly one booking (the `Booking.slotId` UNIQUE constraint), the
  rest `409` — asserted against persisted state**; inactive service / past /
  already-booked slot; address ownership; DTO shape (no user ids, no raw model);
  search / filter / pagination (Milestone 12).
- **operations** — dashboard aggregates; booking list filter / sort /
  pagination; detail DTO; the allowed status transitions and the rejected ones;
  concurrent status change caught by the conditional update; technician
  management, qualifications, assignment / reassignment, schedule-conflict
  rejection, `FOR UPDATE` serialisation; role enforcement on every route.
- **technician** — profile; assigned-jobs list; job detail; `assigned →
in_progress → completed` and the rejected transitions; ownership
  (`user → Technician.userId → Technician.id → Booking.technicianId`),
  cross-technician `404`.
- **AI assistant** (`ai.integration.test.ts`, fake Claude) — auth (`401`),
  customer-only (`403`), CSRF (`403`), per-user rate limit (`429`), body
  validation and the 2000-char message cap (`422`); malformed model output and
  a thrown Claude error → safe clarification (`200`, not 5xx); grounding drops
  an invented service, an unowned `addressId`, a past date; `clarify`
  re-grounds `priorIntent`; **booking / address counts unchanged after a batch
  of calls**; `503` when unconfigured; `availability` returns real slots (public
  DTO only) and still answers from a template when the assistant is off.

## Concurrency & database invariants

Concurrency-sensitive behaviour is verified against **persisted state**, not
just HTTP status:

| Scenario                                   | Guard (PostgreSQL)                                         | Test                               |
| ------------------------------------------ | ---------------------------------------------------------- | ---------------------------------- |
| two customers book the same slot           | `Booking.slotId` UNIQUE                                    | `booking.integration.test.ts`      |
| overlapping technician availability        | GiST `EXCLUDE` on `tstzrange`                              | `availability.integration.test.ts` |
| concurrent booking status change           | conditional `updateMany` on the read status                | `operations.integration.test.ts`   |
| concurrent technician assignment           | `SELECT … FOR UPDATE` on `Technician` + conditional update | `technician.integration.test.ts`   |
| transaction rollback on a mid-flow failure | the whole `$transaction` aborts; nothing persists          | booking-creation failure paths     |

No constraint is weakened for testing.

## Test data & isolation

- **Seed data** (`packages/database/src/seed.ts`) is deterministic and small:
  5 users (2 customers, 1 operations, 2 technicians), 14 services (13 active),
  3 categories, 28 availability slots (future-dated, days 1–7), 6 technician
  qualifications. **No seeded bookings** — suites create the booking states they
  need.
- Every seeded account uses the password `aisbp-dev-password` (development
  only).
- **Vitest / PostgreSQL**: suites delete only the rows they create (prefix
  filters) and leave the seed intact; `fileParallelism: false` in the API
  package so the suites do not race on the shared database.
- **Vitest / Redis**: the API vitest config points `REDIS_URL` at logical DB
  **15**; auth-touching suites `flushdb` between tests.
- **E2E / PostgreSQL**: `apps/e2e/global-setup.ts` runs once — `migrate deploy`,
  delete every non-seed user / address / booking / history row, re-run the
  idempotent seed (which also rebuilds the slots), then add one E2E fixture
  (Tomas also qualified for Wi-Fi mesh, so a booking on Tara's slot can be
  reassigned). It never runs `migrate reset`.
- **E2E / Redis**: the E2E API server uses logical DB **1**; `global-setup`
  flushes it.
- E2E specs mostly register their own throwaway customers (`e2e-…@example.test`)
  so their data does not collide; where a spec needs a specific booking it
  navigates by id rather than picking `.first()` from a shared list.

## Authentication in tests

- **Integration**: `apps/api/src/test/helpers.ts` — `registerUser` / `loginUser`
  read the real `Set-Cookie` header and echo the CSRF cookie back in
  `X-CSRF-Token`, exactly as a browser would. No auth shortcut exists.
- **E2E**: `uiLogin` types into the real login form; API-setup helpers
  `POST /api/v1/auth/login` with the seeded password and carry the returned
  cookie. There is **no** test-only auth bypass, no disabled CSRF, no hidden
  header, no production backdoor. The only test-environment seam is
  `setClaudeClientForTesting` (guarded to `NODE_ENV=test`) and the
  `AI_ASSISTANT_STUB` flag (guarded out of production).

## External AI mocking

Claude is never called from CI or the local test run.

- **Integration**: `setClaudeClientForTesting(fake)` injects a scripted
  `ClaudeClient`; the helper throws unless `NODE_ENV=test`.
- **E2E**: the API server runs with `AI_ASSISTANT_STUB=true`, which selects a
  deterministic in-process `stubClaudeClient` (keyword matching over the prompt
  context — not a model). It is ignored when `NODE_ENV=production`. Server-side
  grounding runs on its output identically to a real response, so the stub
  changes nothing the API trusts.

## E2E journeys (implemented)

`apps/e2e` — Playwright, Chromium, `workers: 1`, `retries: 1` in CI. The config
builds `@aisbp/web` (production build, `vite preview` on :4173) and
`@aisbp/api` (`:4100`) and waits for `/api/v1/health`.

| Spec                     | Journey                                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customer.spec.ts`       | register → browse catalogue → open a service → view availability → add an address → book a slot → see it in the account → cancel it                                    |
| `operations.spec.ts`     | (setup: a customer books) → sign in as operations → dashboard → open the queued booking → confirm → assign a qualified technician                                      |
| `technician.spec.ts`     | (setup: booked + confirmed + assigned) → sign in as technician → jobs list → open the job → `Start job` → `Mark complete`                                              |
| `ai-assistant.spec.ts`   | sign in → open the assistant → send a booking request → the stub grounds a complete intent → follow "Review & book" → **complete the booking through the normal flow** |
| `access-control.spec.ts` | a customer is blocked from `/operations` and `/technician/*`; an anonymous visitor is redirected to `/login`; operations cannot use the customer-only assistant        |

The AI journey deliberately routes the final booking through the normal
`/services/:slug` flow — the assistant never bypasses booking validation.

## Coverage

Coverage is **measured and reported, not gated.** `pnpm test:coverage` prints a
V8 text summary per Vitest package (`@vitest/coverage-v8`, `text-summary` +
`json-summary`). There is no CI threshold: an arbitrary global percentage would
reward shallow tests. The priority is that the **critical business and security
paths** listed above have explicit tests, which they do. Component tests
(`apps/web`) and the thin `@aisbp/database` package are run for coverage but not
a focus — their logic lives in `packages/shared` and the integration suites.

## CI

`.github/workflows/ci.yml` runs, in order: install → format check → lint →
typecheck → Prisma validate → migrate on a clean database → seed →
`pnpm test:coverage` (unit + integration + component) → `pnpm build` → cache +
install the Playwright Chromium build → `pnpm test:e2e`. On an E2E failure the
Playwright HTML report is uploaded as an artifact. No step is allowed to fail
silently — there is no `|| true`, no skipped suite, no masked exit code.

## Security & performance regression tests (Milestone 16)

The M16 review confirmed the existing suite already covers the attack-scenario
checklist — unauthenticated access, wrong-role access, customer & technician
IDOR (`404`, non-enumerating), malformed `:id` (`422`), mass assignment
(`.strict()` → `422`), arbitrary Prisma-filter injection
(`?where[id]=…&select=password` returns the caller's own page), CSRF (missing
**and** wrong token), price tampering, invalid booking transitions, technician
qualification bypass, technician assignment conflicts under concurrency, AI
mutation / authorization bypass, and sensitive-DTO leakage (serialised-response
string assertions).

New regression tests added for the M16 fixes:

- `packages/shared/src/availability.test.ts` — `checkSlotTimes` rejects a
  sub-`SLOT_MIN_MINUTES` slot; `AVAILABILITY_PUBLIC_MAX_SLOTS` is bounded.
- `packages/shared/src/pagination.test.ts` — `page=1000` accepted, `page=1001`
  rejected (`PAGE_MAX` lowered).
- `apps/api/.../availability.integration.test.ts` — a 10-minute slot → `422`;
  the public availability response is capped at `AVAILABILITY_PUBLIC_MAX_SLOTS`
  even when more slots exist.
- `apps/api/.../operations.integration.test.ts` — `?page=1001` → `422`,
  `?page=1000` → `200`.
- `apps/api/.../auth.integration.test.ts` — a poisoned Redis session blob with
  an unknown `role` → `401` (no privilege escalation); a same-length-but-wrong
  CSRF token → `403` (constant-time compare must not throw).
- `apps/api/.../ai.integration.test.ts` — the model cannot add `status` /
  `technicianId` / `price` / `userId` to the intent (Zod strips them; they
  never reach a DTO).

Performance is measured out-of-band (`scratchpad/m16-perf*.sql`,
`EXPLAIN (ANALYZE, BUFFERS)` on synthetic data) and recorded in
[Performance](performance.md#measured--milestone-16) — not asserted with
wall-clock thresholds in CI. Query counts per list endpoint are documented
there and confirmed by reading the repository code; the Prisma client is not
instrumented for query-event counting.

## Non-goals

No tests asserting exact pixel layout. Prefer behaviour, accessibility roles,
and user-visible outcomes.
