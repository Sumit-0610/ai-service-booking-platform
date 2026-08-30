import { Redis } from 'ioredis';
import { env } from '../config/env.js';

/**
 * Single Redis connection for the process. Only the session store and the rate
 * limiter use this; route handlers never see it.
 */
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  lazyConnect: true,
});

export async function connectRedis(): Promise<void> {
  if (redis.status === 'wait' || redis.status === 'end') {
    await redis.connect();
  }
  await redis.ping();
}

export async function disconnectRedis(): Promise<void> {
  await redis.quit();
}
