import { defineConfig } from 'vitest/config';

// Integration tests use a dedicated Redis logical DB (15) so they can safely
// flush between runs without touching a developer's or another job's data.
const redisBase = (process.env.REDIS_URL ?? 'redis://localhost:6379').replace(/\/\d+$/, '');

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      REDIS_URL: `${redisBase}/15`,
      // Trust the forwarded IP so each test can present a distinct client IP and
      // not share a rate-limit bucket with its neighbours.
      TRUST_PROXY: 'true',
      LOGIN_RATE_LIMIT_MAX: '5',
      LOGIN_RATE_LIMIT_WINDOW_SECONDS: '60',
      REGISTER_RATE_LIMIT_MAX: '5',
      REGISTER_RATE_LIMIT_WINDOW_SECONDS: '60',
    },
  },
});
