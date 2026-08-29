# Local Development

## Prerequisites

- Node.js 20
- pnpm 11
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
```

The example values are local placeholders only. Do not commit real secrets.

## Start Local Infrastructure

```bash
docker compose up -d postgres redis
```

PostgreSQL listens on `localhost:5432` and Redis listens on `localhost:6379`.

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
- Web: `http://localhost:5173`
- Health endpoint: `http://localhost:4000/api/v1/health`

## Validation

Run the full local validation suite:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
