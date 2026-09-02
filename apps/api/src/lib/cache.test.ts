import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeConnections } from '../test/helpers.js';
import { cacheKey, createCache } from './cache.js';
import { redis } from './redis.js';

/**
 * Cache-boundary tests against the real Redis logical DB (15) the API test
 * suite already uses. The "Redis unavailable" case uses a throwaway client
 * pointed at a dead port so a real connection failure is exercised, not a mock.
 */

const realCache = createCache(redis, true);

afterAll(closeConnections);
beforeEach(async () => {
  await redis.flushdb();
});

const identity = (data: unknown): unknown => data;

describe('cacheKey', () => {
  it('namespaces and versions keys and never collides across namespaces', () => {
    expect(cacheKey('catalogue', 'categories')).toBe('cache:catalogue:v1:categories');
    expect(cacheKey('catalogue', 'service', 'wifi-mesh-setup')).toBe(
      'cache:catalogue:v1:service:wifi-mesh-setup',
    );
    expect(cacheKey('catalogue')).toBe('cache:catalogue:v1');
    expect(cacheKey('pricing', 'quote', 'x')).not.toBe(cacheKey('catalogue', 'quote', 'x'));
  });
});

describe('cache (real Redis)', () => {
  it('returns null on a miss and the stored value on a hit', async () => {
    const key = cacheKey('test', 'k1');
    expect(await realCache.get(key, identity)).toBeNull();

    await realCache.set(key, { a: 1, b: ['x'] }, 60);
    expect(await realCache.get(key, identity)).toEqual({ a: 1, b: ['x'] });
  });

  it('applies the TTL passed to set', async () => {
    const key = cacheKey('test', 'ttl');
    await realCache.set(key, { ok: true }, 45);
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(30);
    expect(ttl).toBeLessThanOrEqual(45);
  });

  it('getOrSet loads on a miss, populates the cache, then serves the hit', async () => {
    const key = cacheKey('test', 'gos');
    let loads = 0;
    const load = async (): Promise<{ n: number }> => {
      loads += 1;
      return { n: loads };
    };

    expect(await realCache.getOrSet(key, 60, identity, load)).toEqual({ n: 1 });
    expect(await realCache.getOrSet(key, 60, identity, load)).toEqual({ n: 1 });
    expect(loads).toBe(1);
  });

  it('del and delByPrefix remove entries without touching other namespaces', async () => {
    await realCache.set(cacheKey('catalogue', 'a'), 1, 60);
    await realCache.set(cacheKey('catalogue', 'b'), 2, 60);
    await realCache.set(cacheKey('other', 'c'), 3, 60);

    await realCache.del(cacheKey('catalogue', 'a'));
    expect(await realCache.get(cacheKey('catalogue', 'a'), identity)).toBeNull();

    const removed = await realCache.delByPrefix(`${cacheKey('catalogue')}:`);
    expect(removed).toBe(1); // only "b" was left
    expect(await realCache.get(cacheKey('catalogue', 'b'), identity)).toBeNull();
    expect(await realCache.get(cacheKey('other', 'c'), identity)).toBe(3);
  });

  it('treats a corrupt or wrong-version entry as a miss', async () => {
    const key = cacheKey('test', 'corrupt');
    await redis.set(key, 'not json at all', 'EX', 60);
    expect(await realCache.get(key, identity)).toBeNull();

    await redis.set(key, JSON.stringify({ v: 'v0', data: { old: true } }), 'EX', 60);
    expect(await realCache.get(key, identity)).toBeNull();
  });

  it('treats an entry that no longer matches its decoder as a miss', async () => {
    const key = cacheKey('test', 'shape');
    await realCache.set(key, { unexpected: 'shape' }, 60);
    const decode = (data: unknown): { required: string } => {
      if (typeof (data as { required?: unknown }).required !== 'string') {
        throw new Error('shape drift');
      }
      return data as { required: string };
    };
    expect(await realCache.get(key, decode)).toBeNull();
  });

  it('is a no-op reader/writer when disabled', async () => {
    const disabled = createCache(redis, false);
    const key = cacheKey('test', 'disabled');
    await disabled.set(key, { a: 1 }, 60);
    expect(await redis.get(key)).toBeNull();
    expect(await disabled.get(key, identity)).toBeNull();

    let loads = 0;
    const value = await disabled.getOrSet(key, 60, identity, async () => {
      loads += 1;
      return { fromSource: true };
    });
    expect(value).toEqual({ fromSource: true });
    expect(loads).toBe(1);
  });
});

describe('cache when Redis is unavailable', () => {
  const deadClient = new Redis(6399, '127.0.0.1', {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  const deadCache = createCache(deadClient, true);

  afterAll(() => {
    deadClient.disconnect();
  });

  it('falls back to the source of truth instead of failing the request', async () => {
    const key = cacheKey('test', 'dead');
    expect(await deadCache.get(key, identity)).toBeNull();
    await expect(deadCache.set(key, { a: 1 }, 60)).resolves.toBeUndefined();

    let loads = 0;
    const value = await deadCache.getOrSet(key, 60, identity, async () => {
      loads += 1;
      return { servedFromPostgres: true };
    });
    expect(value).toEqual({ servedFromPostgres: true });
    expect(loads).toBe(1);
  });
});
