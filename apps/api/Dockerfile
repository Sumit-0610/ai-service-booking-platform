# syntax=docker/dockerfile:1
#
# Production image for @aisbp/api. Build context = repository root.
#   docker build -f apps/api/Dockerfile -t aisbp-api .
#
# Stages:
#   build      — full (dev) install of the API subgraph + `tsc` build
#   prod-deps  — build re-installed with production dependencies only
#   migrator   — one-shot `prisma migrate deploy` (has the Prisma CLI)
#   runtime    — prod-deps with the workspace tree intact; runs as `node`
#
# The runtime carries the built JS, the generated Prisma client, and the pruned
# `node_modules`; the workspace TypeScript sources also ride along (they are the
# same code — trimming them is a follow-up, tracked in docs/repository-structure.md).

FROM node:22-alpine AS base
# openssl is required by the Prisma engines on Alpine (musl / OpenSSL 3).
RUN apk add --no-cache openssl
RUN corepack enable
ENV CI=true
WORKDIR /repo

# --------------------------------------------------------------------------
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
# schema + migrations are needed by the `postinstall` (prisma generate)
COPY packages/database/prisma ./packages/database/prisma
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/e2e/package.json ./apps/e2e/
RUN pnpm install --frozen-lockfile --filter "@aisbp/api..."

COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY packages/database ./packages/database
COPY apps/api ./apps/api
# `@aisbp/api...` builds the API and every workspace dependency in topological order.
RUN pnpm --filter "@aisbp/api..." run build

# --------------------------------------------------------------------------
FROM build AS prod-deps
RUN pnpm install --frozen-lockfile --filter "@aisbp/api..." --prod --ignore-scripts

# --------------------------------------------------------------------------
# One-shot migrator: invoke the Prisma binary directly (no pnpm wrapper, so no
# workspace deps-status check), runs as root — a short-lived job that only
# touches the database. Committed migrations only.
FROM build AS migrator
WORKDIR /repo/packages/database
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

# --------------------------------------------------------------------------
FROM prod-deps AS runtime
ENV NODE_ENV=production
USER node
WORKDIR /repo/apps/api
EXPOSE 4000
# Tiny Node probe — no curl/wget added to the image.
HEALTHCHECK --interval=10s --timeout=3s --start-period=40s --retries=10 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/server.js"]
