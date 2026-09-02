# Architecture

## Product Direction

AI Service Booking Platform is a production-style home and service installation booking platform. Customers book ordinary home services, operations users manage bookings and technicians, and technicians complete assigned jobs. AI is an assisting capability, not the source of truth for business mutations.

## System Shape

The approved architecture is a modular monolith with separate frontend and backend applications in one repository.

- Frontend: React, TypeScript, React Router, React Hook Form, Zod, Tailwind CSS, selective Redux Toolkit.
- Backend: Node.js, Express, TypeScript.
- Database: PostgreSQL through Prisma.
- Cache: Redis for sessions, rate limiting, and measured cache needs.
- AI: Claude API behind backend service boundaries.
- API style: versioned REST under `/api/v1`.
- Infrastructure: Docker for local dependencies and GitHub Actions for validation.

## Backend Layering

Controllers should stay thin. They parse request context, call validated service methods, and return API responses.

Request flow:

```txt
HTTP request
-> Express route
-> authentication and authorization middleware
-> request validation
-> controller
-> domain service
-> repository/data access
-> Prisma transaction when required
-> PostgreSQL
```

## Domain Modules

Implemented so far: `auth` and `session` (Milestone 4), plus the
`@aisbp/database` data-access layer (Milestone 3). The rest are planned.

The backend is organized by domain boundary:

- `auth`: registration, login, logout, current session, password handling.
  Implemented at `apps/api/src/modules/auth`, with the Redis session
  abstraction at `apps/api/src/modules/session` and reusable auth/authz
  middleware at `apps/api/src/middleware`.
- `users`: shared user profile behavior.
- `addresses`: customer-owned service locations.
- `service-catalog`: categories, services, search, filtering, sorting, pagination.
  Backed by a Redis read-through cache boundary (`apps/api/src/lib/cache.ts`,
  Milestone 13) — a pure optimisation over PostgreSQL, catalogue endpoints only.
- `availability`: technician/service time slots and scheduling checks.
- `pricing`: price calculation and booking price snapshot creation.
- `bookings`: booking lifecycle, modification, cancellation, status timeline.
- `technicians`: technician profile and availability management.
- `operations`: dashboards, assignment, operational views.
- `ai`: Claude integration and structured booking intent extraction
  (Milestone 14). Implemented at `apps/api/src/modules/ai`, behind the
  `ClaudeClient` boundary at `apps/api/src/lib/claude.ts` (the only Anthropic
  SDK import). Read-only — it never calls a repository to mutate; booking
  creation stays on the normal booking flow.

## Frontend Boundaries

The frontend should be feature-oriented rather than grouped only by technical file type. Local route and form state should remain local where possible. Redux Toolkit should be used only when state must survive route changes or be shared across distant features, such as authenticated user context or a booking draft.

Expected areas:

- Customer service discovery and booking flow.
- Customer addresses and booking history.
- Operations dashboard and assignment tools.
- Technician assigned-job views.
- AI booking assistant interface.

## Pricing Principle

Pricing is a first-class business concern. Services may change price over time, but each booking must store the final agreed price and breakdown at the time of booking. Historical bookings must not be recalculated from current service prices.

For MVP, pricing stays simple: calculate from service base price plus explicit simple fees or discounts. Do not introduce a rules engine unless a concrete requirement appears.

## Transaction Safety

Booking creation, modification, cancellation, slot reservation, technician assignment, and status transitions should be service-level operations. Any operation that changes multiple records must use a database transaction.

## Error Handling

The API should expose consistent errors with stable codes, user-safe messages, and appropriate HTTP status codes. Internal details, stack traces, provider errors, and database errors should not leak to clients.
