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
      ci.yml
  docker-compose.yml
  pnpm-workspace.yaml
  package.json
  README.md
```

## Structure Rules

- Application feature code belongs under `apps/web/src/features` or `apps/api/src/modules`.
- Cross-cutting backend helpers belong under `apps/api/src/shared` only when reused by multiple modules.
- Shared API types and validation schemas may live in `packages/shared` when both frontend and backend use them.
- Prisma schema, migrations, seed script, and the data-access layer belong in `packages/database`. Nothing else imports Prisma or the generated client directly.
- Documentation belongs in `docs` and should be updated when architectural decisions change.

As of Milestone 6 the backend has `apps/api/src/{config,lib,middleware,modules,types}`
with `modules/{auth,session,catalogue,addresses}`; the frontend has
`apps/web/src/{components,features}` with `features/{auth,catalogue,addresses}`.
Other planned directories appear as the milestones that need them land.

## MVP Constraint

This structure should support a realistic portfolio project without introducing microservices. The boundary is modular, but deployment can remain simple.
