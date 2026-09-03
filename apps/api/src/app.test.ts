import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { redis } from './lib/redis.js';

describe('health endpoint', () => {
  afterAll(async () => {
    if (redis.status !== 'end') {
      redis.disconnect();
    }
  });

  it('returns the API health contract', async () => {
    const response = await request(createApp()).get('/api/v1/health').expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'api',
    });
    expect(typeof response.body.timestamp).toBe('string');
  });

  it('omits the version block for an unstamped build (Milestone 18)', async () => {
    // The test process has no APP_VERSION / APP_COMMIT / APP_BUILD_TIME, so the
    // optional block must be absent rather than present-with-nulls.
    const response = await request(createApp()).get('/api/v1/health').expect(200);
    expect(response.body).not.toHaveProperty('version');
  });

  it('returns a consistent 404 envelope for unknown routes', async () => {
    const response = await request(createApp()).get('/api/v1/does-not-exist').expect(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
  });
});
