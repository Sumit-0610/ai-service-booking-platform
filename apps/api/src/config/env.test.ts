import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

/**
 * Milestone 18 — the production configuration guards. `loadEnv` is pure over its
 * env source, so these run with fabricated environments and never touch
 * `process.env`.
 */

const base = {
  DATABASE_URL: 'postgresql://app:pw@db:5432/aisbp',
  REDIS_URL: 'redis://redis:6379',
} satisfies NodeJS.ProcessEnv;

describe('loadEnv — production WEB_ORIGIN fail-fast', () => {
  it('throws when NODE_ENV=production and WEB_ORIGIN is missing', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/WEB_ORIGIN must be set/);
  });

  it('throws when NODE_ENV=production and WEB_ORIGIN is an empty string', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', WEB_ORIGIN: '' })).toThrow(
      /WEB_ORIGIN must be set/,
    );
  });

  it('accepts an explicit production WEB_ORIGIN', () => {
    const { env } = loadEnv({
      ...base,
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://app.example.com',
    });
    expect(env.WEB_ORIGIN).toBe('https://app.example.com');
    expect(env.isProduction).toBe(true);
    // Secure cookies default on in production.
    expect(env.COOKIE_SECURE).toBe(true);
  });

  it('still allows a local plain-HTTP production origin (the integration stack)', () => {
    const { env } = loadEnv({
      ...base,
      NODE_ENV: 'production',
      WEB_ORIGIN: 'http://localhost:8080',
    });
    expect(env.WEB_ORIGIN).toBe('http://localhost:8080');
  });

  it('does not require WEB_ORIGIN outside production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'development' })).not.toThrow();
    expect(() => loadEnv({ ...base, NODE_ENV: 'test' })).not.toThrow();
    expect(loadEnv({ ...base }).env.WEB_ORIGIN).toBe('http://localhost:5173');
  });
});

describe('loadEnv — release metadata (Milestone 18)', () => {
  it('reports no version metadata for an unstamped build', () => {
    const loaded = loadEnv({ ...base });
    expect(loaded.hasAppVersion).toBe(false);
    expect(loaded.appVersion).toEqual({
      version: undefined,
      commit: undefined,
      buildTime: undefined,
    });
  });

  it('surfaces version metadata baked into the image', () => {
    const loaded = loadEnv({
      ...base,
      APP_VERSION: '1.4.0',
      APP_COMMIT: 'abc1234',
      APP_BUILD_TIME: '2026-09-03T10:00:00Z',
    });
    expect(loaded.hasAppVersion).toBe(true);
    expect(loaded.appVersion).toEqual({
      version: '1.4.0',
      commit: 'abc1234',
      buildTime: '2026-09-03T10:00:00Z',
    });
  });

  it('treats empty-string metadata (a container "unset" value) as absent', () => {
    const loaded = loadEnv({ ...base, APP_VERSION: '', APP_COMMIT: '', APP_BUILD_TIME: '' });
    expect(loaded.hasAppVersion).toBe(false);
  });

  it('reports a partially stamped build', () => {
    const loaded = loadEnv({ ...base, APP_COMMIT: 'deadbeef' });
    expect(loaded.hasAppVersion).toBe(true);
    expect(loaded.appVersion.commit).toBe('deadbeef');
    expect(loaded.appVersion.version).toBeUndefined();
  });
});
