# AI Service Booking Platform

[![CI](https://github.com/Sumit-0610/ai-service-booking-platform/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Sumit-0610/ai-service-booking-platform/actions/workflows/ci.yml)
[![Release images](https://github.com/Sumit-0610/ai-service-booking-platform/actions/workflows/release.yml/badge.svg)](https://github.com/Sumit-0610/ai-service-booking-platform/actions/workflows/release.yml)

A production-style home-services booking and operations platform, built as a
software-engineering portfolio project. Customers browse a service catalogue,
check technician availability, get a price quote, and book an appointment;
operations staff triage the booking queue and assign technicians; technicians
work their assigned jobs. A Claude-powered assistant helps customers turn a
plain-English request into a booking draft — but it never writes to the
database, and every booking still goes through the normal validated workflow.

> **Portfolio project, not a live service.** It has no real users, no payment
> processing, and is not deployed to a public cloud. "Production-style" refers to
> the engineering practices (transactions, database constraints, RBAC, CSRF, a
> four-layer test suite, containerised deploy artifacts), not a running SaaS.

## What it does

| Area                      | Capability                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Service catalogue**     | Public, cached, paginated/searchable/sortable list of active categories and services                          |
| **Availability**          | Public per-service slot lookup (bounded window, future-only) + technician self-service slot CRUD              |
| **Pricing**               | Server-computed integer-cent quote; the client can never submit a price                                       |
| **Addresses**             | Customer-owned address CRUD, international model, per-row ownership                                           |
| **Booking workflow**      | Transactional creation with an **immutable price snapshot** and an initial status-history row                 |
| **Operations dashboard**  | DB-aggregated metrics + a filterable booking queue + status triage (`confirm` / `reject` / `cancel`)          |
| **Technician management** | Operations-managed technician profiles, service **qualifications**, and booking **assignment / reassignment** |
| **Technician job flow**   | `assigned → in_progress → completed`, owner-scoped, state-machine-enforced                                    |
| **Search / pagination**   | One shared list contract across every collection endpoint; deterministic, server-bounded                      |
| **Redis caching**         | Read-through cache over the **public catalogue only** — a pure optimisation over PostgreSQL                   |
| **AI booking assistant**  | Claude drafts a structured booking intent; the server re-grounds every field and stays authoritative          |
| **Deployment**            | Multi-stage Docker images, a one-shot migration container, GHCR publishing, a self-hosted Compose stack       |

Not implemented (deliberately out of MVP scope): payments, notifications,
reviews/ratings, password reset, booking reschedule, a pricing rules engine.

## Key engineering highlights

- **Transactional booking creation.** `POST /api/v1/bookings` runs one
  PostgreSQL transaction that re-validates address ownership, slot availability,
  service active state, and future-dating, snapshots the price from the service
  row read _inside the same transaction_, inserts the booking + its first
  `BookingStatusHistory` row, and flips the slot to `booked`.
- **Immutable, server-authoritative pricing.** Money is integer minor units
  everywhere; there is no floating-point arithmetic in pricing. The client may
  name a service by slug but can never submit a subtotal, fee, tax, discount, or
  total. The six snapshot columns are written once and never recomputed — a
  later `Service.basePriceCents` change does not touch an existing booking
  (asserted by an integration test).
- **Concurrency handled in the database, not with app-level locks.**
  `Booking.slotId` `UNIQUE` is the double-booking guard (concurrent creates →
  exactly one wins, the rest `409`); a GiST `EXCLUDE` constraint over
  `tstzrange` prevents overlapping technician slots; booking status changes use
  a conditional `updateMany` on the last-read status; technician assignment
  takes a `SELECT … FOR UPDATE` row lock. Each is covered by a
  concurrency-focused integration test that asserts **persisted state**.
- **Role-scoped workflows.** `requireAuth` / `requireRole` / `requireResourceOwner`
  middleware gate every protected route server-side; the React route guards are
  UX only. Cross-owner access returns `404`, not `403`, so resource existence is
  never revealed (IDOR defence).
- **AI safety boundary.** The Claude assistant returns only a _draft_ intent.
  The service re-grounds every field against real records — an invented service
  slug, an `addressId` the caller does not own, or a past date is dropped and
  reported in `missingFields`. Model output that fails Zod validation, or any
  Claude error, becomes a safe clarification response (HTTP 200, never a 5xx,
  never a mutation). Claude never calls a repository, assigns a technician, sets
  a price, or changes a status.
- **Redis as a pure optimisation.** The read-through cache serves only the three
  public catalogue endpoints, keyed after Zod validation, namespaced + versioned.
  Every cache failure (outage, corrupt value, shape drift) is logged at `warn`
  and returns a miss — a Redis outage adds database reads, it never takes a read
  path offline. Nothing authenticated or per-user is ever cached.
- **Four-layer test suite** (unit → integration → component → E2E) with
  integration and E2E running against **real PostgreSQL and Redis**. The only
  faked external dependency is the Claude API.
- **Deployment artifacts, not just a Dockerfile.** Multi-stage images (non-root
  API runtime, `nginx-unprivileged` web, a dedicated `prisma migrate deploy`
  migrator), published to GHCR by a CI-gated release workflow with immutable
  `sha-<commit>` tags and OCI revision labels; `GET /api/v1/health` reports the
  running commit.

## Architecture

Modular monolith, one repository, strict layering:

```txt
React SPA (apps/web)
    │  fetch, credentials: 'include'
    ▼
Express API  (apps/api)      versioned REST under /api/v1
    │
    ▼
route  →  auth / RBAC / CSRF middleware  →  controller  →  service  →  repository
                                                                          │
                                                          @aisbp/database (Prisma)
                                                                          │
                                                                          ▼
                                                     PostgreSQL 16      Redis 7
                                              (source of truth)   (sessions, rate limits,
                                                                   catalogue cache)
```

- Controllers stay thin: parse request context, call a validated service, shape
  the response.
- Only `@aisbp/database` imports Prisma or the generated client. `apps/api/src/lib/cache.ts`
  is the only place application code touches the Redis cache; `apps/api/src/lib/claude.ts`
  is the only place the Anthropic SDK is imported.
- Multi-record mutations always run in a `prisma.$transaction`.

**Monorepo packages** (pnpm workspace):

| Package             | Responsibility                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `apps/web`          | React 19 + Vite SPA — catalogue, booking, account, operations, technician, and assistant UIs    |
| `apps/api`          | Express 5 + TypeScript API — all business logic, auth, the AI module, the cache boundary        |
| `apps/e2e`          | Playwright (Chromium) end-to-end suite against the built web + API + real DB/Redis              |
| `packages/database` | `@aisbp/database` — Prisma schema, migrations, seed, generated client, and the repository layer |
| `packages/shared`   | `@aisbp/shared` — cross-cutting Zod schemas and pure logic (pricing, pagination, state machine) |
| `packages/config`   | `@aisbp/config` — shared TypeScript base config                                                 |

Details: **[docs/architecture.md](docs/architecture.md)** ·
**[docs/repository-structure.md](docs/repository-structure.md)** ·
**[docs/domain-model.md](docs/domain-model.md)**

## Tech stack

| Layer            | Choices                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Frontend         | React 19, React Router 7, React Hook Form 7, Zod 4, Tailwind CSS 4, Vite 7 (auth state via React Context, not Redux) |
| Backend          | Node.js ≥ 22.13, Express 5, TypeScript 5.9, Zod 4, Helmet 8                                                          |
| Database         | PostgreSQL 16, Prisma 6.19                                                                                           |
| Cache / sessions | Redis 7 via ioredis 6                                                                                                |
| Auth             | Argon2id (`@node-rs/argon2`), server-side Redis sessions, HttpOnly cookie, CSRF synchronizer token                   |
| AI               | Claude via `@anthropic-ai/sdk` (`claude-sonnet-5` default), behind a `ClaudeClient` interface                        |
| Testing          | Vitest 3, React Testing Library, Playwright 1.62 (Chromium), `@vitest/coverage-v8`                                   |
| Containers       | Docker multi-stage builds, `node:22-alpine`, `nginxinc/nginx-unprivileged`                                           |
| CI/CD            | GitHub Actions (`validate` + `docker` jobs), GHCR image publishing                                                   |
| Tooling          | pnpm 11 workspace, ESLint 9, Prettier 3                                                                              |

## Core workflows

```txt
Customer   browse catalogue → view availability → add/select address → review price
           → create booking (pending) → track status timeline → cancel while allowed

Operations dashboard metrics → open the booking queue → confirm / reject
           → assign a qualified technician → monitor status

Technician assigned jobs list → open a job → start (in_progress) → mark complete

AI         type a request → Claude drafts a structured intent → server re-grounds
 assistant every field against real records → "Review & book" hands off to the
           normal /services/:slug booking flow (the assistant never books)
```

Full HTTP contracts: **[docs/api.md](docs/api.md)**.

## Security

An **internal** security & performance review (Milestone 16 — not a third-party
audit) walked the full request path plus the AI flow, the cache, and the
frontend. Implemented controls:

- **Authentication** — Argon2id hashing (OWASP baseline params); 256-bit CSPRNG
  session ids in Redis; HttpOnly `SameSite=Lax` cookie (`Secure` in production);
  session-fixation defence (fresh id on every login); sliding TTL.
- **Authorization** — server-side `requireAuth` / `requireRole` /
  `requireResourceOwner`; owner-scoped repository `where` clauses; cross-owner
  access → non-enumerating `404`.
- **CSRF** — synchronizer token in the session, echoed in `X-CSRF-Token` on
  every mutation; constant-time comparison (`crypto.timingSafeEqual`).
- **Input validation** — Zod on every body / param / query; `.strict()` bodies
  reject mass assignment; `:id` params shape-checked before any query; closed
  `sort` / filter enums, so no client value reaches a Prisma `where` / `select` /
  `orderBy`.
- **Money** — computed and snapshotted server-side; no client-supplied monetary
  value is ever trusted.
- **Database integrity** — `UNIQUE`, GiST `EXCLUDE`, and `CHECK` constraints
  (including a price-total-consistency check) enforce invariants in PostgreSQL.
- **Rate limiting** — fixed-window Redis counters on `login` (per IP + per email)
  and `register` (per IP), and a per-user limit on the AI endpoints.
- **Data minimisation** — every response is an explicit narrow DTO; no password
  hash, session blob, or raw foreign key is exposed.
- **Deployment** — secrets come from the environment (`${VAR:?}`, no dev
  fallback); `WEB_ORIGIN` is required in production; `COOKIE_SECURE` /
  `TRUST_PROXY` are pinned on in the deploy stack; PostgreSQL and Redis stay
  private; nothing secret is committed or logged.

Full model: **[docs/security.md](docs/security.md)** ·
**[docs/authentication.md](docs/authentication.md)** ·
**[docs/ai-architecture.md](docs/ai-architecture.md)**

## Testing

```txt
Unit         Vitest, no I/O            pure logic: pricing, pagination, booking state machine,
                                       AI intent schema, availability rules, address/catalogue schemas
   │
Integration  Vitest + real PG + Redis  every API module through real HTTP (supertest): auth, RBAC,
                                       CSRF, rate limits, cache hit/miss/fallback, IDOR, the slot
                                       exclusion constraint, booking transactions & double-booking
                                       under concurrency, operations & technician flows, AI grounding
   │
Component    Vitest + jsdom + RTL      React route/form behaviour with fetch mocked
   │
E2E          Playwright (Chromium)     full journeys against the built web + API + real DB/Redis
```

Current suite at this commit (`pnpm test` / `pnpm test:e2e`, local, matching CI):

| Layer                                 | Files | Tests   |
| ------------------------------------- | ----- | ------- |
| `@aisbp/shared` (unit)                | 10    | 72      |
| `@aisbp/database` (integration)       | 2     | 14      |
| `apps/web` (component)                | 15    | 90      |
| `apps/api` (integration + a few unit) | 17    | 218     |
| **Vitest total**                      | 44    | **394** |
| Playwright E2E                        | 5     | **7**   |

Integration tests run against real PostgreSQL and Redis; the **only** faked
external dependency is the Claude API (a scripted in-process `ClaudeClient` for
integration, a deterministic stub for E2E — both guarded out of production).
Coverage is **measured and reported** (`@vitest/coverage-v8`), not gated on a
percentage.

E2E journeys: customer register → book → cancel; operations confirm → assign;
technician `start → complete`; AI assistant handoff **through the normal booking
flow**; role/access guards.

Full strategy: **[docs/testing.md](docs/testing.md)**.

## Performance

Performance work is **evidence-based** — `EXPLAIN (ANALYZE, BUFFERS)` on
synthetic datasets, recorded with dataset size, PostgreSQL version, query shape,
and method. Milestone 16 measured against **30,000 bookings / 20,000 users /
37,000 slots** on a local PostgreSQL 14; every list endpoint is served by an
existing index or a bounded top-N / aggregate scan, and issues a fixed number of
queries independent of row count (no N+1).

Two optimisations are **deliberately deferred with documented triggers**: a
`Booking(status, createdAt)` composite index (turns the unfiltered operations
queue into a pure index scan — trigger: bookings table into the hundreds of
thousands) and a `pg_trgm` GIN index for the operations text search (trigger:
user table past ~50,000 rows).

> These are development/benchmark measurements on a single box, not production
> SLAs or a scalability guarantee.

Full numbers: **[docs/performance.md](docs/performance.md)** ·
**[docs/database.md](docs/database.md)**

## Deployment

```txt
GitHub Actions ──(CI green for the commit)──▶ Release workflow
                                                   │  build + push
                                                   ▼
                            GHCR:  …-api  …-migrator  …-web        immutable  sha-<commit>  tags
                                                   │  docker compose pull
                                                   ▼
Internet ─HTTPS▶ reverse proxy / TLS ─▶ web (nginx) ─▶ API ─▶ PostgreSQL / Redis
 (operator-provided)                    :8080          :4000      (compose network, never public)
```

- **Three images** from two multi-stage Dockerfiles: the API runtime (non-root
  `node`, `node dist/server.js`), a one-shot `migrator` (`prisma migrate deploy`
  — committed migrations only, never `reset` / `db push`), and the web SPA
  served by `nginx-unprivileged`.
- **`.github/workflows/release.yml`** publishes to GHCR using the built-in
  `GITHUB_TOKEN` (no registry secret). It runs only after the `CI` workflow
  succeeds for that commit **and** re-verifies the commit's check-runs before
  pushing. Tags: `sha-<12-char commit>` always, `latest` for `main`.
- **`docker-compose.deploy.yml`** pulls those images (never builds), selects the
  release with `IMAGE_TAG`, requires every secret (`${VAR:?}`), pins
  `NODE_ENV=production` / `COOKIE_SECURE=true` / `TRUST_PROXY=true`, and keeps
  `api` / `web` on `127.0.0.1`. `docker-compose.prod.yml` is the separate
  local/CI build-and-run integration stack.
- **Ordering**: pull → Postgres/Redis healthy → `migrate deploy` (one-shot) →
  API/web start → health-check. HTTPS termination and `X-Forwarded-*` forwarding
  are the operator's reverse proxy — **the repository provisions no cloud
  infrastructure**.

Operator runbook (prerequisites, env vars, reverse proxy, health verification,
rollback): **[docs/deployment.md](docs/deployment.md)**.

## Quick start

**Prerequisites:** Node.js ≥ 22.13, pnpm 11 (via Corepack), Docker.

```bash
# 1. install
pnpm install

# 2. start PostgreSQL 16 + Redis 7
docker compose up -d postgres redis

# 3. environment files (local placeholders)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp packages/database/.env.example packages/database/.env

# 4. migrate + seed
pnpm --filter @aisbp/database db:migrate:deploy
pnpm --filter @aisbp/database db:seed

# 5. run web + API
pnpm dev
#   web → http://localhost:5173
#   API → http://localhost:4000  (health: /api/v1/health)

# 6. tests (needs the DB + Redis from step 2, migrated + seeded)
pnpm test
pnpm test:e2e
```

Seeded logins (development password `aisbp-dev-password`): `alice@example.com`
(customer), `olivia@ops.example.com` (operations), `tomas@tech.example.com`
(technician). The AI assistant needs `ANTHROPIC_API_KEY` in `apps/api/.env`;
without it the assistant endpoints return `503` and the rest of the platform is
unaffected.

Run the whole stack in containers instead:

```bash
docker compose -f docker-compose.prod.yml up -d --build
#   API → http://localhost:4000   web → http://localhost:8080
```

Deploying the published images to a server: see
**[docs/deployment.md](docs/deployment.md)** (do not use the quick-start path for
that).

## Development commands

| Command                                           | What it does                                          |
| ------------------------------------------------- | ----------------------------------------------------- |
| `pnpm dev`                                        | Run `apps/api` + `apps/web` in watch mode             |
| `pnpm build`                                      | Build every workspace (`tsc` / Vite)                  |
| `pnpm lint`                                       | ESLint across all packages                            |
| `pnpm typecheck`                                  | `tsc --noEmit` across all packages                    |
| `pnpm test`                                       | Vitest — unit + integration + component               |
| `pnpm test:coverage`                              | The same, with a V8 coverage summary                  |
| `pnpm test:e2e`                                   | Playwright — builds web + API, runs Chromium journeys |
| `pnpm format:check` / `pnpm format:write`         | Prettier check / write                                |
| `pnpm --filter @aisbp/database db:migrate:deploy` | Apply committed migrations                            |
| `pnpm --filter @aisbp/database db:seed`           | Load deterministic seed data                          |
| `pnpm --filter @aisbp/database db:reset`          | Drop, re-migrate, re-seed (local only)                |

## Project structure

```txt
apps/
  api/    Express 5 + TypeScript API (modules/, middleware/, lib/, config/)
  web/    React 19 + Vite SPA (features/, components/, lib/)
  e2e/    Playwright end-to-end suite
packages/
  database/  @aisbp/database — Prisma schema, migrations, seed, repositories
  shared/    @aisbp/shared — Zod schemas + pure domain logic
  config/    @aisbp/config — shared tsconfig base
docs/       architecture, domain model, API, security, testing, performance, deployment, …
.github/workflows/   ci.yml (validate + docker) · release.yml (GHCR publish)
docker-compose.yml         local dev infra (PostgreSQL + Redis)
docker-compose.prod.yml    local/CI production integration stack (builds images)
docker-compose.deploy.yml  deployment stack (pulls published GHCR images)
```

More: **[docs/repository-structure.md](docs/repository-structure.md)**.

## Documentation

| Document                                                                  | Purpose                                            |
| ------------------------------------------------------------------------- | -------------------------------------------------- |
| [Architecture](docs/architecture.md)                                      | System shape, layering, module boundaries          |
| [Repository Structure](docs/repository-structure.md)                      | Codebase organisation and the compose files        |
| [Domain Model](docs/domain-model.md)                                      | Entities, relationships, the booking state machine |
| [Database](docs/database.md)                                              | Schema, constraints, indexes, migration decisions  |
| [API Boundaries](docs/api.md)                                             | Every HTTP contract, error codes, list conventions |
| [Authentication Strategy](docs/authentication.md)                         | Sessions, CSRF, RBAC middleware, rate limiting     |
| [Security Strategy](docs/security.md)                                     | Controls per milestone + the M16 review            |
| [AI Architecture](docs/ai-architecture.md)                                | The Claude boundary, grounding, fallback           |
| [Testing Strategy](docs/testing.md)                                       | The four layers, fixtures, external-AI mocking     |
| [Performance Strategy](docs/performance.md)                               | Measured query plans and deferred optimisations    |
| [Deployment](docs/deployment.md)                                          | Operator runbook — GHCR → self-hosted Compose      |
| [Local Development](docs/local-development.md)                            | Detailed local setup                               |
| [Responsible AI-Assisted Development](docs/responsible-ai-development.md) | How AI assistance was used on this repo            |
| [Milestone Plan](docs/milestones.md)                                      | The 19-milestone build history and scope           |

## Project status

Milestones **1–19 complete**, CI green on `main`. The build history is a
19-milestone sequence — schema and auth, the booking domain, operations and
technician workflows, search/pagination, Redis caching, the Claude assistant, a
three-layer-plus-E2E test strategy, an internal security & performance review,
containerisation, deployment, and this portfolio pass. See
[docs/milestones.md](docs/milestones.md).

## License

Released under the [MIT License](LICENSE).
