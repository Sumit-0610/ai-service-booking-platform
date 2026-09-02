# Milestone Plan

This is the single canonical milestone numbering for the project. Any other
numbering in older notes is superseded by this list.

## Current Milestone

**Milestone 15: Unit, integration, and E2E testing — not started.**

A milestone is not complete until the full validation suite (`format:check`,
`lint`, `typecheck`, `test`, `build`, plus Prisma schema/migration/seed
validation) and GitHub Actions CI are green on `origin/main`.

Milestones 1–14 are complete with CI green on `origin/main`.

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

### M15: Unit, integration, and E2E testing

Vitest unit and integration coverage, React Testing Library component coverage,
and Playwright end-to-end journeys.

### M16: Security and performance review

Security review of auth, authorization, and AI boundaries; performance
measurement of core endpoints and the frontend bundle.

### M17: Docker and CI/CD

Application Docker images, CI hardening, and pipeline coverage for the full test
suite including E2E smoke tests.

### M18: Deployment

Deployment configuration and documentation.

### M19: README and GitHub portfolio polish

Final portfolio README, screenshots, and repository presentation.

## Development Rule

Complete one milestone, validate it, and stop. Do not jump across multiple
milestones in a single change.
