import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './index.js';

describe('healthResponseSchema', () => {
  it('accepts the API health response contract', () => {
    const parsed = healthResponseSchema.parse({
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
    });

    expect(parsed.status).toBe('ok');
    expect(parsed.version).toBeUndefined();
  });

  it('accepts an optional release-metadata block (Milestone 18)', () => {
    const parsed = healthResponseSchema.parse({
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
      version: { version: '1.4.0', commit: 'abc1234', buildTime: '2026-09-03T10:00:00Z' },
    });

    expect(parsed.version).toEqual({
      version: '1.4.0',
      commit: 'abc1234',
      buildTime: '2026-09-03T10:00:00Z',
    });
  });

  it('accepts a partial release-metadata block', () => {
    const parsed = healthResponseSchema.parse({
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
      version: { commit: 'abc1234' },
    });

    expect(parsed.version).toEqual({ commit: 'abc1234' });
  });
});
