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
    database/
      prisma/
        schema.prisma
        migrations/
        seed.ts
    shared/
      src/
        types/
        schemas/
        constants/
  docs/
    architecture.md
    repository-structure.md
    domain-model.md
    api.md
    authentication.md
    security.md
    ai-architecture.md
    testing.md
    performance.md
    responsible-ai-development.md
    milestones.md
  infra/
    docker/
    github-actions/
  docker-compose.yml
  package.json
  README.md
```

## Structure Rules

- Application feature code belongs under `apps/web/src/features` or `apps/api/src/modules`.
- Cross-cutting backend helpers belong under `apps/api/src/shared` only when reused by multiple modules.
- Shared API types and validation schemas may live in `packages/shared` when both frontend and backend use them.
- Prisma schema, migrations, and database seed scripts belong in `packages/database`.
- Documentation belongs in `docs` and should be updated when architectural decisions change.

## MVP Constraint

This structure should support a realistic portfolio project without introducing microservices. The boundary is modular, but deployment can remain simple.
