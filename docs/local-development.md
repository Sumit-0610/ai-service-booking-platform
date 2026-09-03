# Local Development

## Prerequisites

- Node.js 22 (minimum 22.13.0, as required by pnpm 11.19)
- pnpm 11 (managed via Corepack; the version is pinned in `package.json`)
- Docker

## Install Dependencies

```bash
pnpm install
```

## Environment Files

Copy the example files before running apps locally:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp packages/database/.env.example packages/database/.env
```

The example values are local placeholders only. Do not commit real secrets.

## Start Local Infrastructure

```bash
docker compose up -d postgres redis
```

PostgreSQL listens on `localhost:5432` and Redis listens on `localhost:6379`.
This is the dev stack — you run `apps/api` and `apps/web` on the host.

To instead run the **whole platform in containers** (production images, API on
`:4000`, web on `:8080`), use `docker compose -f docker-compose.prod.yml up -d
--build`. See
[Repository Structure](repository-structure.md#containerisation-milestone-17).

There are three compose files, each with one job:

| File                        | Builds? | Purpose                                                                              |
| --------------------------- | ------- | ------------------------------------------------------------------------------------ |
| `docker-compose.yml`        | —       | local dev infra: PostgreSQL + Redis, host-published                                  |
| `docker-compose.prod.yml`   | yes     | local/CI production **integration** stack — builds all images                        |
| `docker-compose.deploy.yml` | no      | **deployment** stack — pulls published GHCR images (see [Deployment](deployment.md)) |

`docker-compose.deploy.yml` is not for local use: it requires real production
secrets (`${VAR:?…}`) and expects an HTTPS reverse proxy in front.

## Set Up the Database

Apply migrations and load deterministic development data:

```bash
pnpm --filter @aisbp/database db:migrate:deploy
pnpm --filter @aisbp/database db:seed
```

`pnpm --filter @aisbp/database db:reset` drops, re-migrates, and re-seeds.

See [Database](database.md) for the schema, constraints, and access layer.

Every seeded account uses the password `aisbp-dev-password` (development only).
Seeded logins:

- `alice@example.com` / `bob@example.com` — customer
- `olivia@ops.example.com` — operations
- `tomas@tech.example.com` / `tara@tech.example.com` — technician

## Redis

The API needs Redis for sessions, login rate limiting, and the public catalogue
read-through cache (Milestone 13). `REDIS_URL` is in `apps/api/.env.example`,
alongside the optional `CACHE_ENABLED` / `CATALOGUE_CACHE_TTL_SECONDS` knobs. The
API integration tests use a dedicated logical DB (15) on the same server, so
running `pnpm test` will not disturb your dev sessions. If Redis is down the
catalogue still serves from PostgreSQL — the cache is a pure optimisation.

## AI Booking Assistant (Milestone 14)

The `/api/v1/ai/booking-assistant/*` endpoints call the Claude API. Set
`ANTHROPIC_API_KEY` in `apps/api/.env` to use them locally (see
`apps/api/.env.example` for `ANTHROPIC_MODEL` and the other knobs). **Without a
key the endpoints return `503` and the rest of the platform is unaffected.**
The test suite never calls the real API — it injects a fake Claude client — so
`pnpm test` needs no key.

## Run Applications

Run both apps from the repository root:

```bash
pnpm dev
```

Or run them independently:

```bash
pnpm --filter @aisbp/api dev
pnpm --filter @aisbp/web dev
```

Default URLs:

- API: `http://localhost:4000`
- Web: `http://localhost:5173` (the service catalogue is the home page)
- Health endpoint: `http://localhost:4000/api/v1/health`
- Catalogue API: `http://localhost:4000/api/v1/services`

## Validation

Run the full local validation suite (PostgreSQL must be running and the
database migrated and seeded — the integration tests use it):

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @aisbp/database db:validate
pnpm test
pnpm build
```

These are the same checks GitHub Actions runs on every push and pull request.
CI applies the migration and seed against a fresh PostgreSQL container before
running the tests.
