# syntax=docker/dockerfile:1
#
# Production image for @aisbp/web. Build context = repository root.
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_BASE_URL=https://api.example.com -t aisbp-web .
#
# `VITE_API_BASE_URL` is baked into the bundle at build time — it must be the URL
# the *browser* uses to reach the API, not a container-internal name. The build
# output is static files served by an unprivileged nginx with SPA history
# fallback.

FROM node:22-alpine AS build
RUN corepack enable
ENV CI=true
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/e2e/package.json ./apps/e2e/
# Only the web subgraph — @aisbp/database (and Prisma) are never installed here.
RUN pnpm install --frozen-lockfile --filter "@aisbp/web..."

COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

ARG VITE_API_BASE_URL=http://localhost:4000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter "@aisbp/web..." run build

# Release metadata (Milestone 18) — a plain-text stamp served at /version.txt so
# an operator can confirm which commit's bundle nginx is serving. Not secret.
ARG APP_VERSION=""
ARG APP_COMMIT=""
ARG APP_BUILD_TIME=""
RUN printf 'version=%s\ncommit=%s\nbuildTime=%s\napiBaseUrl=%s\n' \
      "$APP_VERSION" "$APP_COMMIT" "$APP_BUILD_TIME" "$VITE_API_BASE_URL" \
      > /repo/apps/web/dist/version.txt

# --------------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
ARG APP_VERSION=""
ARG APP_COMMIT=""
ARG APP_BUILD_TIME=""
LABEL org.opencontainers.image.title="aisbp-web" \
      org.opencontainers.image.description="AI Service Booking Platform web SPA (nginx)" \
      org.opencontainers.image.source="https://github.com/Sumit-0610/ai-service-booking-platform" \
      org.opencontainers.image.version="$APP_VERSION" \
      org.opencontainers.image.revision="$APP_COMMIT" \
      org.opencontainers.image.created="$APP_BUILD_TIME"
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=5 \
  CMD ["/bin/sh", "-c", "wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1"]
