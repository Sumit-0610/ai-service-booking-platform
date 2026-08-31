# Milestone Plan

This is the single canonical milestone numbering for the project. Any other
numbering in older notes is superseded by this list.

## Current Milestone

**Milestone 9: Booking workflow — in progress.**

A milestone is not complete until the full validation suite (`format:check`,
`lint`, `typecheck`, `test`, `build`, plus Prisma schema/migration/seed
validation) and GitHub Actions CI are green on `origin/main`.

Milestones 1–8 are complete with CI green on `origin/main`.

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

### M9: Booking workflow — in progress

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

### M10: Operations dashboard

Operations dashboard, booking detail view, and operational analytics using real
stored data only.

### M11: Technician management and assignment

Technician profiles and active status, technician assignment to bookings, and
technician job-status/completion flow.

### M12: Search, filtering, pagination, and performance

Consistent search, filtering, sorting, and pagination across list endpoints,
with measured performance work.

### M13: Redis caching

Deliberate caching of hot, non-sensitive read paths. Redis is never a second
source of truth for booking or availability state.

### M14: Claude AI Booking Assistant

Claude API backend integration, structured intent extraction, schema validation,
clarification questions, service discovery, and availability assistance. Claude
never mutates booking or database state directly.

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
