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

Milestone 3 (PostgreSQL + Prisma + domain schema) is in progress: the `@aisbp/database` package holds the Prisma schema for the nine core entities, the initial migration, a deterministic dev seed, and a repository-based data-access layer. Milestone 2 (project scaffold) is complete with CI green. Authentication, API endpoints, and frontend features are not implemented yet.

See [docs/milestones.md](docs/milestones.md) for the canonical milestone plan and the current milestone.

## Local Validation

Requires Node.js 22 (>= 22.13.0) and pnpm 11 via Corepack.

```bash
pnpm install
docker compose up -d postgres redis
pnpm --filter @aisbp/database db:migrate:deploy
pnpm --filter @aisbp/database db:seed
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
