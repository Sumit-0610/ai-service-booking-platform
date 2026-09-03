# Milestone Plan

This is the single canonical milestone numbering for the project. Any other
numbering in older notes is superseded by this list.

## Current Milestone

**Milestone 19: README and GitHub portfolio polish — not started.**

A milestone is not complete until the full validation suite (`format:check`,
`lint`, `typecheck`, `test`, `build`, plus Prisma schema/migration/seed
validation) and GitHub Actions CI are green on `origin/main`.

Milestones 1–18 are complete with CI green on `origin/main`.

## Milestones

### M1: Planning and documentation — complete

Architecture, repository structure, domain and database model, API boundaries,
authentication and security strategy, AI architecture, testing strategy,
performance strategy, and responsible AI-assisted development guidance.

No user-facing application features in this milestone.

### M2: Project scaffold — complete

- pnpm monorepo workspace (`apps/*`, `packages/*`)
- `apps/web` (Vite + React + TypeScript) and `apps/api` (Express + TypeScript)
- `packages/shared` and `packages/config`
- strict TypeScript, ESLint, Prettier
- environment variable validation with placeholder-only examples
- Express bootstrap with `/api/v1/health`
- frontend-to-API connectivity check
- Docker Compose for PostgreSQL and Redis
- GitHub Actions CI running format check, lint, typecheck, test, and build

Stop for approval if scaffold tooling choices require changing the approved stack.

### M3: PostgreSQL + Prisma + domain schema — complete

Prisma schema for the core entities, the initial migration, deterministic seed
data, deliberate indexes and constraints, and a repository-based data-access
layer. Includes first-class booking price snapshot fields. See
[Database](database.md).

No authentication, API CRUD endpoints, or frontend features in this milestone.

### M4: Authentication and authorization — complete

Register/login/logout/me endpoints, Argon2id password hashing, Redis-backed
HttpOnly cookie sessions, CSRF protection, rate limiting, reusable
`requireAuth` / `requireRole` / `requireResourceOwner` middleware, and a minimal
login/register/logout web UI. See [Authentication Strategy](authentication.md).

No booking, catalogue, dashboard, or AI features in this milestone.

### M5: Service catalogue — complete

Public read-only catalogue: `GET /api/v1/categories`, `GET /api/v1/services`
(search / category filter / sort / pagination), `GET /api/v1/services/:slug`,
and a responsive customer-facing catalogue UI. Active data only. See
[API Boundaries](api.md) and [Database](database.md).

No availability, booking, dashboard, or AI work in this milestone.

### M6: Address management — complete

Authenticated customer CRUD for `Address` (`/api/v1/addresses`): server-side
per-row ownership, Zod validation, international model, referential-safe delete,
and a focused address-management UI. Customer role only. No schema change. See
[API Boundaries](api.md) and [Security Strategy](security.md).

### M7: Availability and scheduling — complete

Public availability lookup for an active service
(`GET /api/v1/services/:slug/availability`, bounded time window, future-only,
public DTO) and technician self-service slot CRUD
(`/api/v1/technician/availability`, per-row ownership, CSRF, database-enforced
overlap prevention). Customer and technician scheduling UIs. UTC throughout;
no schema change. Booking is **not** implemented. See [API Boundaries](api.md),
[Database](database.md), and [Security Strategy](security.md).

No booking creation, technician assignment, pricing, or AI work in this
milestone.

### M8: Pricing — complete

Deterministic, pure pricing calculation (`calculateServicePrice` in
`@aisbp/shared`) and a public live price quote
(`GET /api/v1/services/:slug/price`, active service only, explicit `PriceQuote`
DTO). MVP rule: `subtotal = Service.basePriceCents`; fees, tax, and discount are
structurally zero (no rules defined). Integer cents only, no floating point, no
rounding, no currency conversion. The pricing service performs no writes — the
immutable booking snapshot is Milestone 9. Service detail page shows the quote
breakdown. No schema change. See [API Boundaries](api.md),
[Database](database.md), and [Security Strategy](security.md).

No coupons, promotions, subscriptions, payments, rules engine, or booking
persistence in this milestone.

### M9: Booking workflow — complete

Customer booking creation (`POST /api/v1/bookings`, body `{ slotId, addressId,
customerNotes? }` only) in one PostgreSQL transaction: address-ownership /
active-service / available-future-slot revalidation, server-side price snapshot
from the pricing calculation, initial `BookingStatusHistory`, and the slot
flipped to `booked`. Double-booking is prevented by the `Booking.slotId` UNIQUE
constraint — concurrent creates yield exactly one booking, the rest `409`.
Customer list / detail / status-history / cancel endpoints (own bookings only,
CSRF on mutations). The documented state machine is enforced; M9 wires only
customer cancellation. Read-only technician view of jobs on their own slots.
Customer booking UI on the service detail page plus a bookings page with the
status timeline. No schema change. See [API Boundaries](api.md),
[Database](database.md), and [Security Strategy](security.md).

No booking modification / reschedule, operations confirmation / assignment,
technician job-status flow, payments, notifications, refunds, coupons, reviews,
or AI in this milestone.

### M10: Operations dashboard — complete

Operations-only (`requireRole('operations')`) read-and-triage surface:
`GET /api/v1/operations/dashboard` (booking counts by status, active / upcoming,
committed revenue by currency, technician counts — all DB aggregations),
`GET /api/v1/operations/bookings` (filter by status / free-text / scheduled-date
range, sort, bounded pagination), `GET /api/v1/operations/bookings/:id` (full
detail + status timeline with actor), and
`PATCH /api/v1/operations/bookings/:id/status` for the operations transitions
that need no technician (`pending -> confirmed`, `pending -> rejected`,
`confirmed -> cancelled`) — state-machine-enforced, CSRF-protected,
transactional, recorded in `BookingStatusHistory`. Dashboard + booking-detail
UI with route guards. No schema change. See [API Boundaries](api.md),
[Database](database.md), and [Security Strategy](security.md).

Technician assignment, technician profile / active-status management, and the
technician job-status flow are **Milestone 11**, not this milestone.

### M11: Technician management and assignment — complete

Operations technician management (`/api/v1/operations/technicians` — list /
detail / active-status / service qualifications) backed by a new
`TechnicianService` join table (the M7 deferral, resolved). Operations booking
assignment / reassignment (`POST /api/v1/operations/bookings/:id/assign-technician`)
— transactional, `FOR UPDATE`-locked per technician, validating active +
qualified + no schedule conflict; the booking keeps its slot and the price
snapshot is untouched. Technician job flow
(`PATCH /api/v1/technician/bookings/:id/status`, `assigned -> in_progress ->
completed`) and a read-only technician profile. Operations technician-management
UI and a technician jobs UI. One migration
(`20260901120000_technician_service`). See [API Boundaries](api.md),
[Database](database.md), and [Security Strategy](security.md).

### M12: Search, filtering, pagination, and performance — complete

One shared list contract (`@aisbp/shared/pagination`: `pageParams`,
`paginationMeta`, `pageOffset`) applied across every collection endpoint.
`GET /api/v1/bookings` and `GET /api/v1/technician/bookings` gained DB-side
pagination + status filter + `sort` (they previously returned unbounded lists);
`GET /api/v1/operations/technicians` gained `sort`; catalogue / operations
bookings keep their contracts but now use the shared helper. Deterministic
`id`-tiebroken ordering, server-bounded `page`/`limit` (`422`, no clamping),
closed `sort`/filter enums, no client-supplied Prisma filters. Query plans
measured on ~3k bookings — existing indexes cover every list query
sub-millisecond, **no index added** (a `Booking(status, createdAt)` composite is
a documented deferred optimization). No schema change. See
[API Boundaries](api.md#list-conventions-milestone-12),
[Database](database.md#search-filtering--pagination-performance-milestone-12),
and [Security Strategy](security.md).

### M13: Redis caching — complete

A read-through cache boundary (`apps/api/src/lib/cache.ts`) over the existing
single Redis connection, wired to the **public catalogue** only:
`GET /api/v1/categories`, `GET /api/v1/services` (non-search), and
`GET /api/v1/services/:slug`. Namespaced, versioned keys
(`cache:catalogue:v1:…`) built from the validated query allow-list; TTL-only
invalidation (`CATALOGUE_CACHE_TTL_SECONDS`, default 120s) because catalogue
rows have no runtime write path. Redis is a pure optimisation over PostgreSQL —
every cache failure degrades to a miss, so an outage cannot take a read path
offline. Free-text search, pricing, availability, and every authenticated /
per-user response are deliberately **not** cached (see
[API Boundaries](api.md#caching-milestone-13),
[Database](database.md#redis-caching-milestone-13), and
[Security Strategy](security.md#cache-security-milestone-13)). No schema change,
no new dependency (`ioredis` already present).

### M14: Claude AI Booking Assistant — complete

Customer-only assistant at `/api/v1/ai/booking-assistant/{intent,clarify,availability}`
(`requireAuth` → `requireRole('customer')` → per-user rate limit → CSRF). A
Claude client boundary (`apps/api/src/lib/claude.ts`, `@anthropic-ai/sdk`,
default model `claude-sonnet-5`) wraps the SDK behind an interface the tests
fake. `intent` / `clarify` force a `record_booking_intent` tool call, then the
service **re-grounds every field** against real records — a slug that is not an
active service, an `addressId` the caller does not own, or a past date is
dropped and reported in `missingFields`. Model output that fails
`aiBookingIntentSchema`, or a Claude error, returns a safe clarification
fallback (HTTP 200) — never a 5xx, never a mutation. `availability` returns real
slots from the availability service with a Claude-written summary (or a template
when the assistant is unconfigured). With no `ANTHROPIC_API_KEY`, `intent` /
`clarify` return `503 SERVICE_UNAVAILABLE` and the rest of the API is
unaffected. React assistant UI at `/assistant`. One new dependency
(`@anthropic-ai/sdk`); no schema change. See
[AI Architecture](ai-architecture.md), [API Boundaries](api.md#claude-ai-booking-assistant-milestone-14),
and [Security Strategy](security.md#ai-assistant-security-milestone-14).

### M15: Unit, integration, and E2E testing — complete

A deliberate three-layer strategy (see [Testing Strategy](testing.md)):

- **Unit** (Vitest, no I/O) — `packages/shared` pure logic: pricing, pagination,
  booking state machine, AI intent schema + `missingIntentFields`, **new**
  `checkSlotTimes` / `durationMinutes`, `formatPrice` / `formatDuration`,
  `countrySchema` / `formatAddress` / address schemas.
- **Integration** (Vitest + real PostgreSQL + Redis, `supertest`) — every API
  module: auth / authz / CSRF / rate limiting, catalogue + cache hit/miss +
  failure fallback, addresses + IDOR, availability + overlap constraint,
  pricing, bookings (transaction, price snapshot, **double-booking under
  concurrency asserted against persisted state**), operations (transitions,
  assignment, `FOR UPDATE`), technician job flow, AI assistant (fake Claude).
- **Component** (Vitest + jsdom + Testing Library) — `apps/web` routes/forms.
- **E2E** (Playwright / Chromium, new `apps/e2e`) — 5 specs against the built
  web + API + real DB/Redis: customer booking + cancel, operations confirm +
  assign, technician `start → complete`, AI assistant handoff **through the
  normal booking flow**, and role/access guards. Claude is a deterministic
  in-process stub (`AI_ASSISTANT_STUB`, ignored in production) — no real
  Anthropic call in CI.

Coverage is measured (`@vitest/coverage-v8`, `pnpm test:coverage`) and reported,
not gated. CI gained a coverage-reporting test step plus Playwright browser
cache + E2E steps. New dev dependencies: `@playwright/test`,
`@vitest/coverage-v8`. No schema change, no production behaviour change.

### M16: Security and performance review — complete

Systematic review of the full request path (route → middleware → controller →
service → repository → database), the AI flow, the M13 cache, and the frontend.

**Verified controls (no change needed):** owner-scoped repository `where`
clauses (customer / technician IDOR), role gates on every protected router,
`.strict()` bodies + Zod-validated `:id` params + closed sort/filter enums (no
client-supplied Prisma `where` / `select` / `orderBy`), server-only price
snapshots, the `Booking.slotId` UNIQUE / GiST slot-overlap / price-consistency
constraints, explicit narrow DTO selects (no password hash, session, or raw FK
leakage), the AI grounding layer (invented service / foreign address / past
date all dropped; no mutation; no privileged fields), the cache (public
catalogue only, keyed without identity, fails through to PostgreSQL), and the
error handler (generic 500 + server log for anything unmapped — no stack traces
or Prisma messages reach clients).

**Fixes (all with regression tests):**

- **`SLOT_MIN_MINUTES = 15`** — a technician could create tens of thousands of
  sub-minute slots inside the 62-day window; every anonymous availability read
  then had to return them all (measured 88 ms at a 12.5k-slot flood).
- **`AVAILABILITY_PUBLIC_MAX_SLOTS = 250`** — the public availability query had
  no `LIMIT`; now capped (bounds the sort and the payload).
- **`PAGE_MAX` 10 000 → 1 000** — `page=10000` on the operations queue forced an
  `OFFSET ~200 000` full sort (~200 ms measured); no client pages that deep.
- **Constant-time CSRF token comparison** (`crypto.timingSafeEqual`).
- **Stored sessions are Zod-validated on read** — a poisoned Redis blob with an
  unknown `role` is rejected rather than trusted for authorization.

No schema migration, no new dependency, no index added. Query plans measured on
30 000 bookings / 20 000 users — see
[Performance](performance.md#measured--milestone-16). Accepted MVP tradeoffs and
scale-up triggers are documented in
[Security](security.md#security--performance-review-milestone-16) and
[Database](database.md#performance-review-milestone-16).

### M17: Docker and CI/CD — complete

Production-oriented containerisation, no change to application behaviour.

- **`apps/api/Dockerfile`** — multi-stage (`build` → `prod-deps` → `runtime`,
  plus a `migrator` target). `node:22-alpine` + `openssl`; a full workspace
  install builds `@aisbp/shared` + `@aisbp/database` + the API with `tsc`, a
  second install prunes to production dependencies, and the `runtime` stage
  copies only the built JS, the generated Prisma client, and the pruned
  `node_modules`. The runtime runs as `node` (non-root), `CMD ["node",
"dist/server.js"]`, with an image `HEALTHCHECK` against `/api/v1/health`. The
  `migrator` target invokes the Prisma binary directly for `migrate deploy`.
- **`apps/web/Dockerfile`** — builds only the web subgraph (no Prisma), then
  serves the static `dist/` from `nginxinc/nginx-unprivileged` with SPA history
  fallback (`apps/web/nginx.conf`). `VITE_API_BASE_URL` is a build arg — the
  browser-reachable API URL.
- **`docker-compose.prod.yml`** — the full stack: `postgres:16-alpine`,
  `redis:7-alpine` (neither host-published), a one-shot `migrator`
  (`prisma migrate deploy`, `depends_on` Postgres healthy), the `api` (depends
  on Postgres + Redis healthy **and** the migrator completed), and the `web`
  image (depends on the API healthy). Service-name networking; health checks on
  every service. `docker-compose.yml` stays the lightweight dev infra
  (Postgres + Redis only).
- **CI** — the `validate` job is unchanged (all M1–M16 gates). A new `docker`
  job builds the three production images, brings the stack up with
  `--wait`, asserts `/api/v1/health`, that the SPA shell is served, that the
  committed migrations were applied to the clean database, and that a second
  migrator run is a no-op.
- **`.dockerignore`** keeps `node_modules`, build output, the generated Prisma
  client, and every `.env` (except `.env.example`) out of the build context.

`apps/api/deploy.infra.test.ts` guards the container config (no re-published DB
port, health checks present, no destructive migration command, non-root, no
committed secret). `prisma` stays a devDependency (the migrator image keeps
it). The only Prisma change is a generator config: `binaryTargets` gained
`linux-musl-openssl-3.0.x` so the client's query engine works inside the Alpine
image — no data-model change, no migration (`prisma migrate diff` reports no
difference).

One config-parsing fix went with the compose file: the optional
`ANTHROPIC_API_KEY` now treats an empty string as absent, because Compose
forwards `${ANTHROPIC_API_KEY:-}` as `""` when the host variable is unset and
the previous schema rejected that, exiting the API on boot.

### M18: Deployment — complete

Deployment configuration and documentation. No application behaviour change; no
schema change, no migration.

**Deployment decision.** M17 deferred cloud-target selection, registry
publishing, and infrastructure-as-code. The approved docs name no cloud
provider, orchestrator, or IaC tool, so M18 uses the smallest provider-neutral
mechanism: **GitHub Actions → GHCR → self-hosted Docker Compose behind a
reverse proxy.** No cloud infrastructure is provisioned, no staging environment,
no platform-specific rollback API. Full runbook in [Deployment](deployment.md).

- **`.github/workflows/release.yml`** — publishes the `api`, `migrator`, and
  `web` images to GHCR (`ghcr.io/sumit-0610/ai-service-booking-platform-{api,migrator,web}`),
  tagged `sha-<commit>` (always) and `latest` (main only), using the built-in
  `GITHUB_TOKEN` + `packages: write` — no registry secret. Gated: it runs via
  `workflow_run` only when the `CI` workflow concluded `success`, and a
  `Require green CI for this commit` step re-verifies the commit's `validate` +
  `docker` check-runs before any push. `workflow_dispatch` (with a
  `web_api_base_url` input) is subject to the same gate. No `|| true`, no
  `continue-on-error`.
- **`docker-compose.deploy.yml`** — the deployment stack. **Pulls** the
  published images (never builds), release selected by `${IMAGE_TAG}`. Every
  production secret is `${VAR:?…}` (compose refuses to start without it) — no
  localhost/dev fallback for `DATABASE_URL`, `REDIS_URL`, `WEB_ORIGIN`,
  `POSTGRES_PASSWORD`. `NODE_ENV=production`, `COOKIE_SECURE=true`,
  `TRUST_PROXY=true` are pinned. PostgreSQL/Redis stay on `expose:` (named
  volumes, AOF for Redis); `api`/`web` bind to `127.0.0.1` only — the operator's
  TLS reverse proxy is the sole public surface. `docker-compose.prod.yml` is
  **unchanged** and remains the local build-and-run integration stack the CI
  `docker` job uses.
- **`.env.production.example`** — every required production variable, placeholders
  only, committed (real `.env.production` stays git-ignored).
- **Production fail-fast** — `apps/api/src/config/env.ts` is refactored into a
  pure, testable `loadEnv(source)`. When `NODE_ENV=production`, a missing (or
  empty) `WEB_ORIGIN` throws with a clear message instead of silently using the
  `http://localhost:5173` dev default. `DATABASE_URL` / `REDIS_URL` already fail
  fast. Local/dev behaviour is unchanged.
- **Release observability** — `APP_VERSION` / `APP_COMMIT` / `APP_BUILD_TIME`
  build args → OCI image labels (`org.opencontainers.image.revision` / `.version`
  / `.created`) + API env. `GET /api/v1/health` gains an **optional** `version`
  block (absent for an unstamped build — additive, existing consumers
  unaffected), the web image serves `/version.txt`, and the API logs one
  `Starting API` line with the commit. No secret in any label or log.
- **CI** — the `docker` job gains one step that `config`-validates
  `docker-compose.deploy.yml` (with throwaway env) and asserts it contains no
  `build:`. The `validate` job and every existing gate are untouched.
- **Regression tests** — `apps/api/deploy.infra.test.ts` extended (19 → 40) plus
  `apps/api/src/config/env.test.ts` (new) for the `loadEnv` guards, and the
  health `version` contract in `packages/shared` + `apps/api`.

Rollback is documented as two distinct operations: **application rollback** =
redeploy the previous `sha-<commit>` image; **database** = never a destructive
reverse, always a forward corrective migration.

### M19: README and GitHub portfolio polish

Final portfolio README, screenshots, and repository presentation.

## Development Rule

Complete one milestone, validate it, and stop. Do not jump across multiple
milestones in a single change.
