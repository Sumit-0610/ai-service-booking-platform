# Repository Structure

The repository will use a monorepo layout with separate frontend and backend applications plus shared packages.

```txt
ai-service-booking-platform/
  apps/
    web/
      src/
        app/
        routes/
        features/
          auth/
          services/
          addresses/
          bookings/
          operations/
          technicians/
          ai-assistant/
        components/
        lib/
        styles/
        tests/
    api/
      src/
        app.ts
        server.ts
        config/
        middleware/
        modules/
          auth/
          users/
          addresses/
          service-catalog/
          availability/
          pricing/
          bookings/
          technicians/
          operations/
          ai-assistant/
        shared/
          errors/
          validation/
          pagination/
          logging/
        tests/
  packages/
    database/            @aisbp/database — Prisma schema, migrations, seed,
      prisma/              generated client, and the data-access layer
        schema.prisma
        migrations/
      generated/         generated Prisma client (git-ignored)
      src/
        client.ts        internal PrismaClient singleton (not exported)
        repositories/    the sanctioned data-access surface
        index.ts         public API of the package
        seed.ts
    shared/              @aisbp/shared — cross-cutting types and Zod schemas
      src/
    config/             @aisbp/config — shared tsconfig base
      tsconfig/
  docs/
    architecture.md
    repository-structure.md
    domain-model.md
    database.md
    api.md
    authentication.md
    security.md
    ai-architecture.md
    testing.md
    performance.md
    responsible-ai-development.md
    local-development.md
    milestones.md
  .github/
    workflows/
      ci.yml             two jobs: `validate` (M1–M16 gates) and `docker`
  apps/api/Dockerfile    multi-stage; targets: build, prod-deps, migrator, runtime
  apps/web/Dockerfile    web build → nginx-unprivileged static server
  apps/web/nginx.conf    SPA history fallback + asset caching
  .dockerignore
  docker-compose.yml     dev infra — PostgreSQL + Redis only
  docker-compose.prod.yml  full stack — postgres, redis, migrator, api, web
  .env.example           variables read by docker-compose.prod.yml
  pnpm-workspace.yaml
  package.json
  README.md
```

## Structure Rules

- Application feature code belongs under `apps/web/src/features` or `apps/api/src/modules`.
- Cross-cutting backend helpers belong under `apps/api/src/shared` only when reused by multiple modules.
- Shared API types and validation schemas may live in `packages/shared` when both frontend and backend use them.
- `packages/shared/src/pagination.ts` (Milestone 12) is the single source of the
  `page` / `limit` query params, the `paginationMeta` response block, and the
  `paginationMeta()` / `pageOffset()` helpers; every list endpoint (catalogue,
  bookings, technician jobs, operations bookings, operations technicians) builds
  its list contract from it.
- Prisma schema, migrations, seed script, and the data-access layer belong in `packages/database`. Nothing else imports Prisma or the generated client directly.
- `apps/api/src/lib/cache.ts` (Milestone 13) is the only place application code
  reads or writes the Redis cache. Like `lib/redis.ts` (the connection) and
  `modules/session/session-store.ts` (session keys), it is a boundary — services
  call `cache.getOrSet`, controllers never see Redis. Only the catalogue service
  uses it so far.
- `apps/api/src/lib/claude.ts` (Milestone 14) is the only place the Anthropic
  SDK is imported. It exposes a `ClaudeClient` interface; `apps/api/src/modules/ai`
  (service / controller / routes) depends on the interface, and the integration
  tests inject a fake. `packages/shared/src/ai.ts` holds the intent schema, the
  request/response DTOs, and the `missingIntentFields` helper.
- `apps/e2e` (`@aisbp/e2e`, Milestone 15) is the Playwright end-to-end suite:
  `playwright.config.ts` (builds + starts the real web and API), `global-setup.ts`
  (deterministic DB + Redis reset), and `tests/*.spec.ts` (one high-value user
  journey each). It has `lint` / `typecheck` / `e2e` scripts but no `build` or
  `test` script, so `pnpm build` / `pnpm test` skip it; `pnpm test:e2e` runs it.
- Documentation belongs in `docs` and should be updated when architectural decisions change.

As of Milestone 11 the backend has `apps/api/src/{config,lib,middleware,modules,types}`
with `modules/{auth,session,catalogue,addresses,availability,pricing,bookings,operations,technicians}`;
the frontend has `apps/web/src/{components,features}` with
`features/{auth,catalogue,addresses,availability,pricing,bookings,operations,technician}`.
Other planned directories appear as the milestones that need them land.

## MVP Constraint

This structure should support a realistic portfolio project without introducing microservices. The boundary is modular, but deployment can remain simple.

## Containerisation (Milestone 17)

Two Compose files, two purposes:

| File                      | Contents                                                                                                                  | Use                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `docker-compose.yml`      | PostgreSQL 16 + Redis 7, host-published                                                                                   | local dev — you run `apps/api` / `apps/web` on the host                              |
| `docker-compose.prod.yml` | postgres, redis, migrator, api, web — production images, service-name networking, PostgreSQL/Redis **not** host-published | run the built stack locally (integration/demo) or as the basis for a real deployment |

**Networking distinctions** (documented in `docker-compose.prod.yml`):

| Hop                   | Address                                         |
| --------------------- | ----------------------------------------------- |
| browser → API         | `http://localhost:${API_PORT}` (host-published) |
| browser → web         | `http://localhost:${WEB_PORT}` (host-published) |
| API → PostgreSQL      | `postgres:5432` (compose service name)          |
| API → Redis           | `redis:6379` (compose service name)             |
| migrator → PostgreSQL | `postgres:5432`                                 |

`VITE_API_BASE_URL` is baked into the web bundle at **image build time**, so it
must be the browser-reachable host URL — never a compose service name.

**Migration flow.** `prisma migrate deploy` runs once, in the `migrator`
one-shot container, before the API starts (`api` `depends_on` `migrator:
service_completed_successfully`). Only committed migrations are applied; the
image never runs `migrate reset`, `migrate dev`, or `db push`. Seeding is
**not** part of the production startup — it is a separate developer/CI action
(`pnpm --filter @aisbp/database db:seed`).

**Deployment boundary.** M17 produces validated build artifacts (the three
images) and a Compose stack that runs them. It does **not** define a cloud
target, a registry push, or infrastructure-as-code — that is Milestone 18.
