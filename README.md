# AI Service Booking Platform

A production-style home and service installation booking platform for a software engineering portfolio.

This project is a normal service booking and operations platform. AI is an additional engineering feature that assists customers with booking intent, service discovery, availability questions, and booking preparation.

## Core Actors

- Customer
- Operations/Admin
- Technician

## Approved Stack

- Frontend: React, TypeScript, React Router, Redux Toolkit where justified, React Hook Form, Zod, Tailwind CSS
- Backend: Node.js, Express, TypeScript
- Database: PostgreSQL, Prisma
- Caching: Redis
- Testing: Vitest, React Testing Library, Playwright
- Infrastructure: Docker, GitHub Actions
- AI: Claude API
- API style: versioned REST API

## Documentation

- [Architecture](docs/architecture.md)
- [Repository Structure](docs/repository-structure.md)
- [Domain Model And Database Design](docs/domain-model.md)
- [Database](docs/database.md)
- [API Boundaries](docs/api.md)
- [Authentication Strategy](docs/authentication.md)
- [Security Strategy](docs/security.md)
- [AI Architecture](docs/ai-architecture.md)
- [Testing Strategy](docs/testing.md)
- [Performance Strategy](docs/performance.md)
- [Responsible AI-Assisted Development](docs/responsible-ai-development.md)
- [Milestone Plan](docs/milestones.md)
- [Local Development](docs/local-development.md)

## Current Status

Milestone 17 (Docker and CI/CD) is complete: production-oriented, multi-stage Dockerfiles for the API (`node:22-alpine`, non-root, minimal runtime, image health check, plus a one-shot `migrator` target) and the web build (`nginx-unprivileged` serving the static SPA); `docker-compose.prod.yml` runs the full stack with service-name networking, health checks, PostgreSQL/Redis kept off host ports, and `prisma migrate deploy` (committed migrations only) gated ahead of the API. CI gained a `docker` job that builds the three images, brings the stack up with `--wait`, and asserts `/api/v1/health`, the served SPA shell, and that migrations landed on a clean database — the existing `validate` job (format, lint, typecheck, Prisma, migrate, seed, unit/integration/coverage, build, Playwright E2E) is unchanged. No schema change, no new dependency. Milestones 1–17 are complete with CI green. Payments are not implemented yet.

See [docs/testing.md](docs/testing.md) for the full test strategy and [docs/repository-structure.md](docs/repository-structure.md#containerisation-milestone-17) for the Docker layout.

See [docs/milestones.md](docs/milestones.md) for the canonical milestone plan and the current milestone.

## Local Validation

Requires Node.js 22 (>= 22.13.0) and pnpm 11 via Corepack.

```bash
pnpm install
docker compose up -d postgres redis
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp packages/database/.env.example packages/database/.env
pnpm --filter @aisbp/database db:migrate:deploy
pnpm --filter @aisbp/database db:seed
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Run the whole stack in Docker

```bash
cp .env.example .env          # optional — every value has a local default
docker compose -f docker-compose.prod.yml up -d --build
# API   -> http://localhost:4000/api/v1/health
# web   -> http://localhost:8080
docker compose -f docker-compose.prod.yml down -v
```

The `migrator` service applies committed migrations before the API starts;
the database is **not** seeded automatically. To seed the containerised
database, run `docker compose -f docker-compose.prod.yml run --rm migrator sh -c
'pnpm --filter @aisbp/database db:seed'`. See
[docs/repository-structure.md](docs/repository-structure.md#containerisation-milestone-17)
for the browser/container/service URL distinctions and the deployment boundary.
