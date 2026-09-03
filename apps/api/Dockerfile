# syntax=docker/dockerfile:1
#
# Production image for @aisbp/api. Build context = repository root.
#   docker build -f apps/api/Dockerfile -t aisbp-api .
#
# Multi-stage: a full workspace install builds @aisbp/shared + @aisbp/database +
# the API with tsc; a second install prunes to production dependencies; the
# runtime stage copies only the built JS, the generated Prisma client, and the
# pruned node_modules onto a minimal Alpine base and runs as a non-root user.
# The `migrator` target keeps the Prisma CLI so a one-shot job can run
# `prisma migrate deploy` before the API starts.

FROM node:22-alpine AS base
# openssl is required by the Prisma query engine on Alpine (musl).
RUN apk add --no-cache openssl
RUN corepack enable
ENV CI=true PNPM_HOME=/root/.local/share/pnpm
WORKDIR /repo

# --------------------------------------------------------------------------
# build — full (dev) install of the API subgraph, then tsc build
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
# prod-deps — same install pruned to production dependencies only
# --------------------------------------------------------------------------
FROM build AS prod-deps
RUN pnpm install --frozen-lockfile --filter "@aisbp/api..." --prod --ignore-scripts

# --------------------------------------------------------------------------
# migrator — one-shot `prisma migrate deploy` (keeps the dev Prisma CLI)
# --------------------------------------------------------------------------
FROM build AS migrator
WORKDIR /repo/packages/database
USER node
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# --------------------------------------------------------------------------
# runtime — minimal: built JS + generated client + pruned node_modules
# --------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build       /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=prod-deps   /repo/node_modules ./node_modules
COPY --from=prod-deps   /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=prod-deps   /repo/packages/database/node_modules ./packages/database/node_modules
COPY --from=prod-deps   /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build       /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build       /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build       /repo/packages/database/package.json ./packages/database/package.json
COPY --from=build       /repo/packages/database/dist ./packages/database/dist
COPY --from=build       /repo/packages/database/generated ./packages/database/generated
COPY --from=build       /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build       /repo/apps/api/dist ./apps/api/dist

USER node
WORKDIR /repo/apps/api
EXPOSE 4000
# A tiny Node one-liner is the health probe — no extra tooling (curl/wget) in the image.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/server.js"]
