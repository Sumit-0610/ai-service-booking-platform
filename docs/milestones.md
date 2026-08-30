# Milestone Plan

This is the single canonical milestone numbering for the project. Any other
numbering in older notes is superseded by this list.

## Current Milestone

**Milestone 2: Project scaffold — in progress.**

Milestone 2 is not complete until the full validation suite (`format:check`,
`lint`, `typecheck`, `test`, `build`) and GitHub Actions CI are green on
`origin/main`.

## Milestones

### M1: Planning and documentation — complete

Architecture, repository structure, domain and database model, API boundaries,
authentication and security strategy, AI architecture, testing strategy,
performance strategy, and responsible AI-assisted development guidance.

No user-facing application features in this milestone.

### M2: Project scaffold — in progress

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

### M3: PostgreSQL + Prisma + domain schema

Prisma schema for the core entities, migrations, seed data, deliberate indexes,
and documented transaction patterns. Includes first-class booking price snapshot
fields.

### M4: Authentication and authorization

Register/login/logout/me endpoints, Argon2id password hashing, Redis-backed
HTTP-only cookie sessions, CSRF protection, role middleware, and customer
ownership checks.

### M5: Service catalogue

Service categories and services, with the read/detail endpoints.

### M6: Address management

Customer-owned service locations: list, create, update, delete, with ownership
enforcement.

### M7: Availability and scheduling

Technician availability slots, availability lookup, and scheduling checks.

### M8: Pricing

Simple MVP pricing service and pricing breakdown response. A booking stores the
final agreed price and breakdown at booking time; later service price changes do
not affect historical bookings.

### M9: Booking workflow

Create, modify, and cancel bookings; booking history; booking status timeline;
transaction-safe slot reservation; stored booking price snapshot; state machine
enforcement.

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
