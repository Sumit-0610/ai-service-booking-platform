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

  it('returns a consistent 404 envelope for unknown routes', async () => {
    const response = await request(createApp()).get('/api/v1/does-not-exist').expect(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
  });
});
