# Deployment

Operator runbook for deploying the AI Service Booking Platform (Milestone 18).

## 1. Deployment architecture

```txt
Internet
   │  HTTPS (443)
   ▼
reverse proxy / TLS termination        operator-provided (nginx, Caddy, Traefik…)
   │                       │
   │  /                    │  /api
   ▼                       ▼
web container (:8080)   api container (:4000)      bound to 127.0.0.1 on the host
                           │            │
                           ▼            ▼
                    postgres (:5432)  redis (:6379)   compose network only — never published
```

Request path inside the API is unchanged from M1–M17:

```txt
route → authentication/authorization → controller → service → repository → @aisbp/database → PostgreSQL
```

The AI assistant remains off the critical path and read-only.

## 2. M18 deployment decision

The repository's approved M18 scope is _"deployment configuration and documentation"_, and M17
explicitly deferred cloud-target selection, registry publishing, and infrastructure-as-code. No
cloud provider, Kubernetes, Terraform/Helm, or managed platform is specified anywhere in the
approved documentation.

**Decision: the smallest provider-neutral mechanism —**

```txt
GitHub Actions  →  GHCR (GitHub Container Registry)  →  self-hosted Docker Compose  →  reverse proxy
```

- GHCR is GitHub-native and authenticates with the workflow's built-in `GITHUB_TOKEN` — no
  external account, no long-lived registry secret.
- The deployment target is a single Docker host running `docker compose`.
- No cloud infrastructure is provisioned, no staging environment is created, and no
  platform-specific rollback API is used.

## 3. Prerequisites

| On              | Need                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| CI/CD           | the repository on GitHub; Actions enabled; `packages: write` permission for `GITHUB_TOKEN` (default for the repo) |
| Deployment host | Linux, Docker Engine ≥ 24 with the Compose plugin, outbound HTTPS to `ghcr.io`                                    |
| Deployment host | a reverse proxy terminating TLS (nginx / Caddy / Traefik) and a DNS record for the public origin                  |
| Operator        | a filled-in `.env.production` (from `.env.production.example`), stored with `chmod 600`, never committed          |

## 4. Repository / image naming

Published to GHCR, lowercase owner/repo:

| Image                                                     | Purpose                                       |
| --------------------------------------------------------- | --------------------------------------------- |
| `ghcr.io/sumit-0610/ai-service-booking-platform-api`      | API runtime (`node dist/server.js`, non-root) |
| `ghcr.io/sumit-0610/ai-service-booking-platform-migrator` | one-shot `prisma migrate deploy`              |
| `ghcr.io/sumit-0610/ai-service-booking-platform-web`      | nginx-unprivileged serving the static SPA     |

Tags:

- `sha-<12-char commit>` — always published; the reproducible, immutable reference.
- `latest` — moved for `main`-branch releases only.

Every image also carries OCI labels: `org.opencontainers.image.revision` (commit),
`org.opencontainers.image.version`, `org.opencontainers.image.created`, `org.opencontainers.image.source`.

## 5. GHCR authentication

The release workflow logs in with:

```yaml
permissions:
  packages: write
- uses: docker/login-action@v3
  with:
    registry: ghcr.io
    username: ${{ github.actor }}
    password: ${{ github.token }}
```

No registry password or PAT is stored. To **pull** on the deployment host:

- public packages: no login needed;
- private packages: `echo "$CR_PAT" | docker login ghcr.io -u <user> --password-stdin`, where
  `CR_PAT` is a personal access token with `read:packages` (host-side only, never committed).

## 6. Release / tagging process

The `Release` workflow (`.github/workflows/release.yml`) publishes images **only for a commit
whose CI has fully passed** (`validate` + `docker` jobs):

- **Automatic** — `workflow_run` after the `CI` workflow completes on `main`; the job runs only
  when that run's conclusion is `success`, and a `Require green CI for this commit` step
  re-verifies the commit's check-runs before any push. Publishes `sha-<commit>` and `latest`.
- **Manual** — `workflow_dispatch` with inputs:
  - `ref` — branch/tag/SHA to build (default `main`);
  - `web_api_base_url` — the `VITE_API_BASE_URL` baked into the web image (default
    `http://localhost:4000`);
  - `publish_latest` — also move `:latest` (default `false`).
    The same `Require green CI` gate applies — a ref without a green CI run cannot be released.

There is no `|| true`, no `continue-on-error`, and no unconditional publish.

## 7. Required production environment variables

Supplied through `--env-file .env.production` (see `.env.production.example`). `docker compose`
**refuses to start** if a `${VAR:?…}` value is missing — there is no development fallback.

| Variable                        | Required    | Source       | Notes                                                                                                                    |
| ------------------------------- | ----------- | ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `IMAGE_TAG`                     | recommended | operator     | release tag to run; defaults to `latest`. Pin `sha-<commit>` for reproducibility                                         |
| `POSTGRES_PASSWORD`             | **yes**     | secret store | password for the bundled `postgres` service                                                                              |
| `DATABASE_URL`                  | **yes**     | secret store | `postgresql://app:<POSTGRES_PASSWORD>@postgres:5432/ai_service_booking_platform` for the bundled DB, or a managed-DB URL |
| `REDIS_URL`                     | **yes**     | config       | `redis://redis:6379` for the bundled Redis, or a managed URL with credentials                                            |
| `WEB_ORIGIN`                    | **yes**     | config       | the public browser-facing origin, e.g. `https://app.example.com`. The API **fails fast** in production without it        |
| `ANTHROPIC_API_KEY`             | optional    | secret store | with no key the AI assistant returns `503`; the rest of the platform is unaffected                                       |
| `POSTGRES_USER` / `POSTGRES_DB` | optional    | config       | default `app` / `ai_service_booking_platform`                                                                            |
| `API_PORT` / `WEB_PORT`         | optional    | config       | loopback host binds (`127.0.0.1:<port>`), default `4000` / `8080`                                                        |

Fixed by `docker-compose.deploy.yml`, **not** set in the env file: `NODE_ENV=production`,
`COOKIE_SECURE=true`, `TRUST_PROXY=true`. Baked into the image at build time: `APP_VERSION`,
`APP_COMMIT`, `APP_BUILD_TIME`.

## 8. `.env.production.example`

Committed, placeholders only, safe to read. `.env.production` itself is git-ignored and
`.dockerignore`d. Copy and fill in:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
$EDITOR .env.production
```

## 9. Docker Compose deployment

`docker-compose.deploy.yml` **pulls** the published images (never builds) and selects the release
with `IMAGE_TAG`.

```bash
# 1. pull the pinned release
export IMAGE_TAG=sha-1a2b3c4d5e6f
docker compose --env-file .env.production -f docker-compose.deploy.yml pull

# 2. apply migrations (one-shot; fails loudly if a migration cannot be applied)
docker compose --env-file .env.production -f docker-compose.deploy.yml run --rm migrator

# 3. start the stack (waits on health + migration completion via depends_on)
docker compose --env-file .env.production -f docker-compose.deploy.yml up -d

# 4. verify (see §12)
```

`docker compose … up -d` also pulls the migrator in via `depends_on:
{ migrator: service_completed_successfully }`, so step 2 is optional but recommended (it surfaces
a migration failure before the API is touched).

Do **not** point `docker-compose.prod.yml` at a deployment host — that file builds images locally
and is the CI integration stack.

## 10. Database migration behaviour

- Production migrations run **only** `prisma migrate deploy` — committed migrations, forward-only.
- The migrator image never runs `prisma migrate reset`, `prisma migrate dev`, or `prisma db push`.
- The migrator is a short-lived one-shot container (`restart: "no"`); it exits after applying
  pending migrations, and a re-run is a no-op (`No pending migrations to apply`).
- The API container has `depends_on: { migrator: service_completed_successfully }`, so it never
  starts against an un-migrated schema.
- **Seeding is not part of deployment.** A fresh production database has schema but no rows.
  Seeding, if wanted for a demo, is a deliberate one-off:
  `docker compose … run --rm --entrypoint sh migrator -c 'node node_modules/tsx/dist/cli.mjs src/seed.ts'`
  — never run against real customer data.
- Migration execution is observable: the migrator's stdout is captured by `docker compose logs
migrator`, and applied migrations are visible in `_prisma_migrations`.

## 11. Reverse proxy / TLS configuration requirements

M18 does not ship a reverse-proxy product. The operator's proxy must:

- **Terminate TLS** on 443 with a valid certificate for `WEB_ORIGIN`'s host.
- **Route** `/` to the web container (`127.0.0.1:${WEB_PORT}`) and `/api/` to the API container
  (`127.0.0.1:${API_PORT}`) on the **same public origin**, so the browser sends the session
  cookie to both.
- **Forward** `X-Forwarded-Proto`, `X-Forwarded-Host`, and `X-Forwarded-For`. The API runs with
  `TRUST_PROXY=true` (trusts one proxy hop) so `req.ip` (rate limiting) and secure-cookie
  handling are correct behind TLS termination.
- `COOKIE_SECURE=true` (fixed in the deploy compose) means the session and CSRF cookies are only
  sent over HTTPS — the proxy **must** serve the app over HTTPS or login will not work.
- `WEB_ORIGIN` must exactly match the browser's origin (scheme + host + port). A mismatch fails
  CORS and rejects the cookie.
- **Only the proxy's 443 is public.** `docker-compose.deploy.yml` binds `web` and `api` to
  `127.0.0.1` and never publishes PostgreSQL or Redis.

Example nginx location block:

```nginx
server {
  listen 443 ssl;
  server_name app.example.com;
  # ssl_certificate ... ssl_certificate_key ...;

  location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

The published `web` image bakes `VITE_API_BASE_URL` at build time. When the browser reaches the
API on the same origin under `/api`, publish the web image with
`VITE_API_BASE_URL=https://app.example.com` (release `workflow_dispatch` input, or a local
`docker build --build-arg`).

## 12. Health verification

Run after every deploy (replace the origin; none of these expose a secret):

```bash
# API is up and reports the running release
curl -fsS https://app.example.com/api/v1/health | jq .
#   { "status": "ok", "service": "api", "timestamp": "...",
#     "version": { "version": "...", "commit": "<sha>", "buildTime": "..." } }

# web SPA shell is served
curl -fsS https://app.example.com/ | grep -q 'id="root"' && echo "web ok"

# static bundle stamp
curl -fsS https://app.example.com/version.txt

# container health (on the host)
docker compose --env-file .env.production -f docker-compose.deploy.yml ps

# migrations applied
docker compose --env-file .env.production -f docker-compose.deploy.yml \
  exec -T postgres psql -U app -d ai_service_booking_platform \
  -tAc "select count(*) from _prisma_migrations where finished_at is not null"

# migrator is idempotent
docker compose --env-file .env.production -f docker-compose.deploy.yml run --rm migrator
#   → "No pending migrations to apply"
```

## 13. Version / commit verification

- **API**: `GET /api/v1/health` → `.version.commit` is the deployed Git SHA. One startup log line
  also carries it: `{"level":"info","message":"Starting API","commit":"<sha>", …}`.
- **Web**: `GET /version.txt` → `commit=<sha>` and the `apiBaseUrl` the bundle was built for.
- **Images**: `docker inspect ghcr.io/…-api:<tag> --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'`.

Confirm all three report the tag you intended to deploy.

## 14. Secret handling

- Secrets come from the deployment environment / `.env.production` only — never Git.
- `.env` and `.env.*` are git-ignored (`.env.example` and `.env.production.example` excepted) and
  `.dockerignore`d, so a developer file cannot enter an image.
- No secret appears in a Dockerfile, a compose file, `.github/workflows/*`, an OCI label, or a
  log line. The logger never receives `DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY`, cookies,
  session ids, or CSRF tokens.
- The release workflow uses only `GITHUB_TOKEN` (`packages: write`); there is no registry PAT in
  the repository.
- On the host, `chmod 600 .env.production`; prefer a real secret store where available.

## 15. Failure behaviour

| Failure                           | What happens                                                                                                            | Operator action                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Migration fails                   | migrator exits non-zero; `api` `depends_on` is not satisfied, so the API does **not** start against a bad schema        | read `docker compose logs migrator`; fix forward (see §17); redeploy          |
| API fails health checks           | container stays `unhealthy`; `web` `depends_on: { api: service_healthy }` keeps traffic off it; `up -d` reports failure | `docker compose logs api`; common causes in §20                               |
| Web deploy fails                  | old `web` container keeps serving until the new one is healthy                                                          | `docker compose logs web`; re-pull the previous `IMAGE_TAG`                   |
| Redis unavailable                 | login / register / AI rate-limit checks fail closed (`500`); the catalogue cache degrades to direct PostgreSQL reads    | restart `redis`; sessions created before the outage are lost (users re-login) |
| Database unavailable              | the API fails its health check and does not serve; `env.ts` also fails fast on a bad `DATABASE_URL` at boot             | restore PostgreSQL; the API recovers on its next start                        |
| Partial deploy (some services up) | `depends_on` + health gating means the API/web only come up once their dependencies are healthy and migrations are done | `docker compose ps`; `up -d` again once the failing dependency is fixed       |

## 16. Application rollback

Redeploy the previous known-good image tag — images are immutable and commit-tagged:

```bash
export IMAGE_TAG=sha-<previous-good-commit>
docker compose --env-file .env.production -f docker-compose.deploy.yml pull
docker compose --env-file .env.production -f docker-compose.deploy.yml up -d
```

This is instant and safe **as long as the previous image is schema-compatible with the current
database** (it is, unless the release you are rolling back from included a migration).

## 17. Database roll-forward strategy

Prisma migrations are **forward-only**. Do **not** reverse an applied migration destructively
(`migrate reset`, hand-written `DROP`s against production).

If a released migration causes a problem:

1. roll the **application** back to the previous image (§16) — only if it still works against the
   new schema (additive migrations usually allow this);
2. author a **new corrective migration** that fixes the schema going forward;
3. get it through CI (clean-DB migrate + apply-on-top-of-history are both checked);
4. release and deploy it via the migrator.

`application rollback` (redeploy previous image) and `database rollback` (never destructive — always
roll forward) are distinct operations.

## 18. Updating to a new release

```bash
# 1. pick the new release
export IMAGE_TAG=sha-<new-commit>          # from the Release workflow summary

# 2. pull it
docker compose --env-file .env.production -f docker-compose.deploy.yml pull

# 3. apply any new migrations first
docker compose --env-file .env.production -f docker-compose.deploy.yml run --rm migrator

# 4. roll the services
docker compose --env-file .env.production -f docker-compose.deploy.yml up -d

# 5. verify health + version (§12, §13); if bad, roll back (§16)
```

## 19. Where each component runs

| Component                                | Runs as                                  | Where                | Exposure                            |
| ---------------------------------------- | ---------------------------------------- | -------------------- | ----------------------------------- |
| reverse proxy                            | operator-provided                        | deployment host      | public 443                          |
| `web` (nginx-unprivileged, uid 101)      | container                                | deployment host      | `127.0.0.1:8080`                    |
| `api` (`node`, non-root)                 | container                                | deployment host      | `127.0.0.1:4000`                    |
| `migrator` (root, one-shot)              | container                                | deployment host      | none — exits after `migrate deploy` |
| `postgres`                               | container + named volume `postgres-data` | deployment host      | compose network only                |
| `redis` (AOF, named volume `redis-data`) | container                                | deployment host      | compose network only                |
| image build & publish                    | GitHub Actions                           | GitHub-hosted runner | pushes to GHCR                      |

## 20. Troubleshooting common startup failures

| Symptom                                                                              | Likely cause                                                                           | Fix                                                                        |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `WEB_ORIGIN must be set explicitly when NODE_ENV=production` on API start            | `WEB_ORIGIN` missing from `.env.production`                                            | set it to the public HTTPS origin                                          |
| `docker compose` errors `POSTGRES_PASSWORD is required` / `DATABASE_URL is required` | a `${VAR:?}` value is unset                                                            | fill it in `.env.production` and pass `--env-file`                         |
| API `unhealthy`, logs show a Prisma connection error                                 | `DATABASE_URL` password ≠ `POSTGRES_PASSWORD`, or DB not ready                         | align the two; the migrator/`depends_on` waits for `pg_isready`            |
| API `unhealthy`, logs show a Redis error                                             | `REDIS_URL` wrong, or Redis container down                                             | check `docker compose ps redis`; fix `REDIS_URL`                           |
| Login succeeds then immediately logs out                                             | app not served over HTTPS while `COOKIE_SECURE=true`, or `WEB_ORIGIN` ≠ browser origin | serve via the TLS proxy; make `WEB_ORIGIN` exact                           |
| Browser console: CORS error calling the API                                          | `WEB_ORIGIN` mismatch, or the SPA bundle points at the wrong API URL                   | fix `WEB_ORIGIN`; rebuild/publish `web` with the right `VITE_API_BASE_URL` |
| `pull access denied` for a GHCR image                                                | package is private and the host is not logged in                                       | `docker login ghcr.io` with a `read:packages` token                        |
| Release workflow fails at `Require green CI for this commit`                         | CI has not finished / did not pass for that SHA                                        | wait for or fix CI; releases are gated on it                               |
