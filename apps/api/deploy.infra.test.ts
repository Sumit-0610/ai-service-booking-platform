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
const deployCompose = read('docker-compose.deploy.yml');
const apiDockerfile = read('apps/api/Dockerfile');
const webDockerfile = read('apps/web/Dockerfile');
const dockerignore = read('.dockerignore');
const gitignore = read('.gitignore');
const ci = read('.github/workflows/ci.yml');
const releaseWorkflow = read('.github/workflows/release.yml');
const envSource = read('apps/api/src/config/env.ts');
const envProductionExample = read('.env.production.example');

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

  it('tolerates an unset optional API key passed as an empty string', () => {
    // Compose forwards ${ANTHROPIC_API_KEY:-} as "" when the host var is unset.
    expect(prodCompose).toMatch(/ANTHROPIC_API_KEY:\s*\$\{ANTHROPIC_API_KEY:-\}/);
    // The env schema must treat "" as absent, not as an invalid key, or the
    // production API exits on boot and never becomes healthy.
    expect(envSource).toMatch(/const optionalEnvString = z\.preprocess\(/);
    expect(envSource).toMatch(/ANTHROPIC_API_KEY:\s*optionalEnvString/);
  });

  it('still builds its images locally — it is the CI integration stack, not the deploy stack', () => {
    expect(prodCompose).toMatch(/build:\s*\n\s*context:\s*\./);
    expect(prodCompose).toContain('dockerfile: apps/api/Dockerfile');
    expect(prodCompose).toContain('dockerfile: apps/web/Dockerfile');
  });

  it('passes release metadata build args through to every image (Milestone 18)', () => {
    // Empty by default (this stack is not a release), but wired so a stamped
    // build is possible.
    expect(prodCompose.match(/APP_COMMIT:\s*\$\{APP_COMMIT:-\}/g)?.length).toBeGreaterThanOrEqual(
      3,
    );
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

describe('docker-compose.deploy.yml (Milestone 18 — published-image deploy stack)', () => {
  it('pulls published GHCR images and never builds', () => {
    expect(deployCompose).not.toMatch(/^\s*build:/m);
    for (const name of ['api', 'migrator', 'web']) {
      expect(deployCompose).toContain(
        `image: ghcr.io/sumit-0610/ai-service-booking-platform-${name}:\${IMAGE_TAG:-latest}`,
      );
    }
  });

  it('lets the operator pick the release tag through an env var', () => {
    expect(deployCompose).toMatch(/\$\{IMAGE_TAG:-latest\}/);
  });

  it('requires the production secrets — no unsafe development fallback', () => {
    // `${VAR:?message}` makes `docker compose` refuse to start without the value.
    for (const required of ['POSTGRES_PASSWORD', 'DATABASE_URL', 'REDIS_URL', 'WEB_ORIGIN']) {
      expect(deployCompose).toMatch(new RegExp(`\\$\\{${required}:\\?`));
    }
    // None of them may carry a localhost / dev default.
    expect(deployCompose).not.toMatch(/DATABASE_URL:\s*\$\{DATABASE_URL:-/);
    expect(deployCompose).not.toMatch(/REDIS_URL:\s*\$\{REDIS_URL:-/);
    expect(deployCompose).not.toMatch(/postgresql:\/\/[^\n]*localhost/);
    expect(deployCompose).not.toMatch(/redis:\/\/localhost/);
  });

  it('pins the HTTPS-appropriate production settings', () => {
    expect(deployCompose).toMatch(/NODE_ENV:\s*production/);
    expect(deployCompose).toMatch(/COOKIE_SECURE:\s*'true'/);
    expect(deployCompose).toMatch(/TRUST_PROXY:\s*'true'/);
  });

  it('keeps PostgreSQL and Redis private and only binds api/web to loopback', () => {
    // No host port maps ending in the DB/Redis ports.
    const published = deployCompose.match(/^\s*-\s*'[^']*:\d+'\s*$/gm) ?? [];
    for (const line of published) {
      expect(line).not.toMatch(/:5432'$/);
      expect(line).not.toMatch(/:6379'$/);
      expect(line).toMatch(/'127\.0\.0\.1:/); // api + web bind to loopback only
    }
    expect(deployCompose).toMatch(/expose:\s*\n\s*-\s*'5432'/);
    expect(deployCompose).toMatch(/expose:\s*\n\s*-\s*'6379'/);
  });

  it('runs the migrator before the API and never destructively', () => {
    expect(deployCompose).toMatch(/migrator:\s*\n\s*image: ghcr\.io\/[^\n]*-migrator/);
    expect(deployCompose).toContain('condition: service_completed_successfully');
    expect(deployCompose).not.toMatch(/migrate\s+reset/);
    expect(deployCompose).not.toMatch(/\bdb\s+push\b/);
    expect(deployCompose).not.toContain('db:reset');
  });

  it('carries no secret and gives every backing service a health check', () => {
    expect(deployCompose).not.toMatch(/sk-ant-[A-Za-z0-9]/);
    expect(deployCompose).not.toMatch(/PASSWORD:\s*['"]?[A-Za-z0-9]{6,}/); // no literal password
    expect(deployCompose.match(/healthcheck:/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe('.env.production.example (Milestone 18)', () => {
  it('is committed but keeps real .env.production ignored', () => {
    expect(gitignore).toContain('!.env.production.example');
    expect(gitignore).toMatch(/^\.env\.\*$/m);
  });

  it('documents every required production variable with placeholders only', () => {
    for (const key of [
      'IMAGE_TAG',
      'POSTGRES_PASSWORD',
      'DATABASE_URL',
      'REDIS_URL',
      'WEB_ORIGIN',
    ]) {
      expect(envProductionExample).toContain(key);
    }
    // Placeholders, not real secrets.
    expect(envProductionExample).not.toMatch(/sk-ant-[A-Za-z0-9]{10}/);
    expect(envProductionExample).toMatch(/replace-with-a-strong-password/);
    expect(envProductionExample).toMatch(/https:\/\/app\.example\.com/);
  });
});

describe('apps/api/Dockerfile', () => {
  it('is multi-stage with a runtime and a migrator target', () => {
    expect(apiDockerfile).toMatch(/AS build\b/);
    expect(apiDockerfile).toMatch(/AS prod-deps\b/);
    expect(apiDockerfile).toMatch(/AS migrator\b/);
    expect(apiDockerfile).toMatch(/AS runtime\b/);
  });

  it('runs the long-lived runtime as a non-root user', () => {
    expect(apiDockerfile).toMatch(/^USER node$/m);
  });

  it('starts the built production server, not a dev tool', () => {
    expect(apiDockerfile).toContain('CMD ["node", "dist/server.js"]');
    expect(apiDockerfile).not.toMatch(/\b(tsx|nodemon|vite|ts-node)\b/);
  });

  it('installs openssl for the Prisma engine and has an image HEALTHCHECK', () => {
    expect(apiDockerfile).toContain('apk add --no-cache openssl');
    expect(apiDockerfile).toContain('HEALTHCHECK');
    expect(apiDockerfile).toContain('/api/v1/health');
  });

  it('applies committed migrations only', () => {
    expect(apiDockerfile).toMatch(/prisma\/build\/index\.js", "migrate", "deploy"/);
    expect(apiDockerfile).not.toMatch(/"migrate",\s*"(reset|dev)"/);
    expect(apiDockerfile).not.toMatch(/prisma\s+db\s+push/);
  });

  it('carries release metadata as build args, OCI labels, and runtime env (Milestone 18)', () => {
    for (const arg of ['APP_VERSION', 'APP_COMMIT', 'APP_BUILD_TIME']) {
      expect(apiDockerfile).toContain(`ARG ${arg}=""`);
    }
    expect(apiDockerfile).toContain('org.opencontainers.image.revision="$APP_COMMIT"');
    expect(apiDockerfile).toContain('org.opencontainers.image.version="$APP_VERSION"');
    expect(apiDockerfile).toContain('org.opencontainers.image.created="$APP_BUILD_TIME"');
    // The runtime reports its own version on /api/v1/health, so it needs the env.
    expect(apiDockerfile).toMatch(/APP_COMMIT="\$APP_COMMIT"/);
    // Never a secret in a label.
    expect(apiDockerfile).not.toMatch(/LABEL[^\n]*(SECRET|PASSWORD|TOKEN|KEY)/i);
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

  it('stamps release metadata into a served version.txt and OCI labels (Milestone 18)', () => {
    expect(webDockerfile).toContain('dist/version.txt');
    expect(webDockerfile).toContain('org.opencontainers.image.revision="$APP_COMMIT"');
  });
});

describe('.github/workflows/release.yml (Milestone 18)', () => {
  it('publishes the three images to GHCR with the built-in token', () => {
    expect(releaseWorkflow).toContain('registry: ghcr.io');
    expect(releaseWorkflow).toContain('packages: write');
    expect(releaseWorkflow).toMatch(/password:\s*\$\{\{\s*github\.token\s*\}\}/);
    for (const name of ['api', 'migrator', 'web']) {
      expect(releaseWorkflow).toMatch(
        new RegExp(`ghcr\\.io/\\$\\{\\{ steps\\.meta\\.outputs\\.repo \\}\\}-${name}:`),
      );
    }
    // API + migrator come from the existing multi-stage Dockerfile targets.
    expect(releaseWorkflow).toContain('target: runtime');
    expect(releaseWorkflow).toContain('target: migrator');
  });

  it('is gated on the existing CI passing for the same commit', () => {
    // workflow_run only proceeds on success…
    expect(releaseWorkflow).toMatch(/workflow_run:/);
    expect(releaseWorkflow).toMatch(/workflows:\s*\['CI'\]/);
    expect(releaseWorkflow).toMatch(/github\.event\.workflow_run\.conclusion == 'success'/);
    // …and every path re-verifies the commit's check-runs before publishing.
    expect(releaseWorkflow).toContain('Require green CI for this commit');
    expect(releaseWorkflow).toMatch(/check-runs/);
  });

  it('never introduces a registry password secret or masks a failure', () => {
    expect(releaseWorkflow).not.toMatch(/\|\|\s*true/);
    expect(releaseWorkflow).not.toMatch(/continue-on-error:\s*true/);
    expect(releaseWorkflow).not.toMatch(/DOCKER_PASSWORD|REGISTRY_PASSWORD|GHCR_TOKEN|GHCR_PAT/);
    expect(releaseWorkflow).not.toMatch(/sk-ant-[A-Za-z0-9]/);
  });

  it('makes every published image traceable to a commit', () => {
    expect(releaseWorkflow).toMatch(/sha-\$\{\{ steps\.meta\.outputs\.short \}\}/);
    expect(releaseWorkflow).toContain('APP_COMMIT=${{ steps.meta.outputs.commit }}');
    expect(releaseWorkflow).toContain(
      'org.opencontainers.image.revision=${{ steps.meta.outputs.commit }}',
    );
  });
});

describe('apps/api/src/config/env.ts (Milestone 18 production guards)', () => {
  it('is a pure, testable loader', () => {
    expect(envSource).toMatch(/export function loadEnv\(source: NodeJS\.ProcessEnv\)/);
  });

  it('fails fast when WEB_ORIGIN is missing in production', () => {
    expect(envSource).toMatch(/isProduction && !source\.WEB_ORIGIN/);
    expect(envSource).toMatch(/WEB_ORIGIN must be set explicitly when NODE_ENV=production/);
  });

  it('exposes release metadata for the running image', () => {
    for (const key of ['APP_VERSION', 'APP_COMMIT', 'APP_BUILD_TIME']) {
      expect(envSource).toContain(`${key}: optionalEnvString`);
    }
    expect(envSource).toMatch(/export const hasAppVersion/);
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

  it('validates the deployment compose file too (Milestone 18)', () => {
    expect(ci).toContain('docker compose -f docker-compose.deploy.yml config --quiet');
    expect(ci).toMatch(/must not build images/);
  });
});
