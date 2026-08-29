import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('health endpoint', () => {
  it('returns the API health contract', async () => {
    const response = await request(createApp()).get('/api/v1/health').expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'api',
    });
    expect(typeof response.body.timestamp).toBe('string');
  });
});
