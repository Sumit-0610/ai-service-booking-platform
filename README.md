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

Milestone 11 (technician management and assignment) is complete: operations manage technician records and per-service qualifications (new `TechnicianService` join table), assign or reassign a technician to a `confirmed`/`assigned` booking (transactional, validated against active status, qualification, and schedule conflicts; the booking keeps its slot and price snapshot), and technicians progress their own jobs `assigned → in_progress → completed`. Milestones 1–11 are complete with CI green. Search/filtering/performance work, Redis caching, payments, and AI features are not implemented yet.

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
