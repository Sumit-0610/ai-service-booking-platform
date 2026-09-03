import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Infrastructure regression checks (Milestone 17). These do NOT run Docker —
 * CI's `docker` job does the real build + stack smoke test. They guard the
 * container config against silent regressions: a re-published database port, a
 * removed health check, a committed secret, a lost migrator stage.
 */

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string): string => readFileSync(root + p, 'utf8');

const prodCompose = read('docker-compose.prod.yml');
const devCompose = read('docker-compose.yml');
const apiDockerfile = read('apps/api/Dockerfile');
const webDockerfile = read('apps/web/Dockerfile');
const dockerignore = read('.dockerignore');
const ci = read('.github/workflows/ci.yml');

describe('docker-compose.prod.yml', () => {
  it('defines the full stack', () => {
    for (const svc of ['postgres:', 'redis:', 'migrator:', 'api:', 'web:']) {
      expect(prodCompose).toContain(svc);
    }
    expect(prodCompose).toContain('image: postgres:16-alpine');
    expect(prodCompose).toContain('image: redis:7-alpine');
  });

  it('gives every stateful/service container a health check', () => {
    // 3 explicit healthcheck blocks: postgres, redis, api.
    expect(prodCompose.match(/healthcheck:/g)?.length).toBeGreaterThanOrEqual(3);
    expect(prodCompose).toContain('pg_isready');
    expect(prodCompose).toContain('redis-cli');
  });

  it('does not publish PostgreSQL or Redis to a host port', () => {
    // The only `ports:` mappings are for api and web.
    const published = prodCompose.match(/^\s*-\s*'?\$\{?\w*.*?:\d+'?$/gm) ?? [];
    for (const line of published) {
      expect(line).not.toMatch(/:5432'?$/);
      expect(line).not.toMatch(/:6379'?$/);
    }
    expect(prodCompose).toMatch(/expose:\s*\n\s*-\s*'5432'/);
    expect(prodCompose).toMatch(/expose:\s*\n\s*-\s*'6379'/);
  });

  it('waits on service readiness, not just container creation', () => {
    expect(prodCompose).toContain('condition: service_healthy');
    expect(prodCompose).toContain('condition: service_completed_successfully');
  });

  it('never runs a destructive migration command', () => {
    expect(prodCompose).not.toMatch(/migrate\s+reset/);
    expect(prodCompose).not.toMatch(/\bdb\s+push\b/);
    expect(prodCompose).not.toContain('db:reset');
  });

  it('carries no hard-coded API key, session secret, or production origin', () => {
    expect(prodCompose).not.toMatch(/sk-ant-[A-Za-z0-9]/);
    expect(prodCompose).not.toMatch(/https:\/\/(?!api\.example\.com)[a-z0-9.-]+\.(com|io|dev|app)/);
    // The Postgres password is a documented local default, supplied via ${VAR:-default}.
    expect(prodCompose).toMatch(/POSTGRES_PASSWORD:\s*\$\{POSTGRES_PASSWORD:-/);
  });
});

describe('docker-compose.yml (dev infra)', () => {
  it('still only provides PostgreSQL + Redis for host-run apps', () => {
    expect(devCompose).toContain('postgres:16-alpine');
    expect(devCompose).toContain('redis:7-alpine');
    expect(devCompose).not.toContain('migrator');
    expect(devCompose).not.toMatch(/\bapi:\s*$/m);
  });
});

describe('apps/api/Dockerfile', () => {
  it('is multi-stage with a runtime and a migrator target', () => {
    expect(apiDockerfile).toMatch(/AS build\b/);
    expect(apiDockerfile).toMatch(/AS prod-deps\b/);
    expect(apiDockerfile).toMatch(/AS migrator\b/);
    expect(apiDockerfile).toMatch(/AS runtime\b/);
  });

  it('runs the runtime and migrator as a non-root user', () => {
    // Two `USER node` lines: migrator + runtime.
    expect(apiDockerfile.match(/^USER node$/gm)?.length).toBe(2);
  });

  it('starts the built production server, not a dev tool', () => {
    expect(apiDockerfile).toContain('CMD ["node", "dist/server.js"]');
    expect(apiDockerfile).not.toMatch(/tsx|nodemon|vite|ts-node/);
  });

  it('installs openssl for the Prisma engine and has an image HEALTHCHECK', () => {
    expect(apiDockerfile).toContain('apk add --no-cache openssl');
    expect(apiDockerfile).toContain('HEALTHCHECK');
    expect(apiDockerfile).toContain('/api/v1/health');
  });

  it('applies committed migrations only', () => {
    expect(apiDockerfile).toContain('prisma", "migrate", "deploy"');
    expect(apiDockerfile).not.toMatch(/migrate",\s*"(reset|dev)"/);
    expect(apiDockerfile).not.toMatch(/prisma\s+db\s+push/);
  });
});

describe('apps/web/Dockerfile', () => {
  it('serves the static build from nginx, not a dev server', () => {
    expect(webDockerfile).toMatch(/nginx-unprivileged/);
    expect(webDockerfile).toContain('/repo/apps/web/dist');
    expect(webDockerfile).not.toMatch(/vite preview|vite dev|pnpm.*dev/);
  });

  it('takes the browser-facing API URL as a build arg', () => {
    expect(webDockerfile).toContain('ARG VITE_API_BASE_URL');
  });
});

describe('.dockerignore', () => {
  it('keeps node_modules, build output, generated client, and secrets out of the context', () => {
    for (const pattern of ['**/node_modules', '**/dist', '**/generated', '**/.env', '**/.env.*']) {
      expect(dockerignore).toContain(pattern);
    }
    expect(dockerignore).toContain('!**/.env.example');
  });
});

describe('CI', () => {
  it('keeps every existing quality gate', () => {
    for (const step of [
      'pnpm format:check',
      'pnpm lint',
      'pnpm typecheck',
      'db:validate',
      'db:migrate:deploy',
      'db:seed',
      'pnpm test:coverage',
      'pnpm build',
      'playwright install',
      'pnpm test:e2e',
    ]) {
      expect(ci).toContain(step);
    }
  });

  it('adds a docker job that builds images and smoke-tests the stack', () => {
    expect(ci).toMatch(/^\s{2}docker:$/m);
    expect(ci).toContain('docker compose -f docker-compose.prod.yml build');
    expect(ci).toContain('up -d --wait');
    expect(ci).toContain('/api/v1/health');
    expect(ci).toContain('_prisma_migrations');
  });

  it('never masks a failure', () => {
    expect(ci).not.toMatch(/\|\|\s*true/);
    expect(ci).not.toMatch(/continue-on-error:\s*true/);
  });
});
