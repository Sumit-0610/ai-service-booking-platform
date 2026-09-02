import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests (Milestone 15). Runs the real built web + API against a real
 * PostgreSQL and Redis. `globalSetup` resets both to a known state before the
 * run, so the specs are deterministic and order-independent.
 *
 * - API on :4100, web (vite preview of the production build) on :4173.
 * - Redis logical DB 1 — never the dev DB (0) or the vitest DB (15).
 * - `AI_ASSISTANT_STUB=true` — the assistant uses a deterministic in-process
 *   stand-in; no real Anthropic call, no API key.
 */

const API_PORT = 4100;
const WEB_PORT = 4173;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://app:app_password@localhost:5432/ai_service_booking_platform';
const REDIS_URL = `${(process.env.REDIS_URL ?? 'redis://localhost:6379').replace(/\/\d+$/, '')}/1`;

export const e2eEnv = { API_URL, WEB_URL, DATABASE_URL, REDIS_URL };

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: './global-setup.ts',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @aisbp/api build && node ../api/dist/server.js',
      url: `${API_URL}/api/v1/health`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: 'development',
        PORT: String(API_PORT),
        WEB_ORIGIN: WEB_URL,
        DATABASE_URL,
        REDIS_URL,
        COOKIE_SECURE: 'false',
        AI_ASSISTANT_ENABLED: 'true',
        AI_ASSISTANT_STUB: 'true',
        AI_RATE_LIMIT_MAX: '100',
        LOGIN_RATE_LIMIT_MAX: '100',
        REGISTER_RATE_LIMIT_MAX: '100',
      },
    },
    {
      command:
        'pnpm --filter @aisbp/web build && pnpm --filter @aisbp/web exec vite preview --port ' +
        `${WEB_PORT} --strictPort --host 127.0.0.1`,
      url: WEB_URL,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: { VITE_API_BASE_URL: API_URL },
    },
  ],
});
