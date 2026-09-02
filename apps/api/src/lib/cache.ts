import type { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';
import { redis } from './redis.js';

/**
 * The read-through cache boundary (Milestone 13).
 *
 * Route handlers never touch this directly — a service owns each key and its
 * TTL and calls `getOrSet`. Redis is a pure optimisation in front of the
 * PostgreSQL source of truth: every failure here (a Redis outage, a corrupt
 * entry, a shape drift) degrades to a plain cache miss, so a healthy read path
 * can never be taken offline by the cache. Nothing authoritative — booking
 * state, pricing snapshots, ownership, authorization — is ever stored here.
 *
 * Serialisation is an explicit JSON envelope (`{ v, data }`); only plain DTO
 * objects are cached. A version bump or a schema change turns every old entry
 * into a clean miss rather than a decode error.
 */

export const CACHE_VERSION = 'v1';
const CACHE_ROOT = 'cache';

interface CacheEnvelope {
  v: string;
  data: unknown;
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Build a namespaced, versioned, collision-free key from parts the caller has
 * already validated/normalised. Shape: `cache:<namespace>:v1:<part>:<part>`.
 */
export function cacheKey(namespace: string, ...parts: Array<string | number>): string {
  const head = `${CACHE_ROOT}:${namespace}:${CACHE_VERSION}`;
  return parts.length > 0 ? `${head}:${parts.map(String).join(':')}` : head;
}

export interface Cache {
  /** Return the decoded value, or `null` on a miss / any failure. */
  get<T>(key: string, decode: (data: unknown) => T): Promise<T | null>;
  set(key: string, data: unknown, ttlSeconds: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
  /** Delete every key starting with `prefix` (SCAN-based, never FLUSHDB). */
  delByPrefix(prefix: string): Promise<number>;
  getOrSet<T>(
    key: string,
    ttlSeconds: number,
    decode: (data: unknown) => T,
    load: () => Promise<T>,
  ): Promise<T>;
}

export function createCache(client: Redis, enabled: boolean): Cache {
  async function get<T>(key: string, decode: (data: unknown) => T): Promise<T | null> {
    if (!enabled) return null;
    let raw: string | null;
    try {
      raw = await client.get(key);
    } catch (error) {
      logger.warn('cache get failed; using source of truth', { key, message: errText(error) });
      return null;
    }
    if (raw === null) return null;
    try {
      const envelope = JSON.parse(raw) as CacheEnvelope | null;
      if (!envelope || envelope.v !== CACHE_VERSION) return null;
      return decode(envelope.data);
    } catch {
      // Corrupt JSON or a value that no longer matches its DTO schema: treat it
      // as a miss and let the TTL clear it.
      logger.warn('cache entry unreadable; treating as miss', { key });
      return null;
    }
  }

  async function set(key: string, data: unknown, ttlSeconds: number): Promise<void> {
    if (!enabled) return;
    try {
      const payload = JSON.stringify({ v: CACHE_VERSION, data } satisfies CacheEnvelope);
      await client.set(key, payload, 'EX', ttlSeconds);
    } catch (error) {
      logger.warn('cache set failed; entry not written', { key, message: errText(error) });
    }
  }

  async function del(...keys: string[]): Promise<void> {
    if (!enabled || keys.length === 0) return;
    try {
      await client.del(...keys);
    } catch (error) {
      logger.warn('cache del failed', { message: errText(error) });
    }
  }

  async function delByPrefix(prefix: string): Promise<number> {
    if (!enabled) return 0;
    let removed = 0;
    try {
      let cursor = '0';
      do {
        const [next, batch] = await client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
        cursor = next;
        if (batch.length > 0) removed += await client.del(...batch);
      } while (cursor !== '0');
    } catch (error) {
      logger.warn('cache delByPrefix failed', { prefix, message: errText(error) });
    }
    return removed;
  }

  async function getOrSet<T>(
    key: string,
    ttlSeconds: number,
    decode: (data: unknown) => T,
    load: () => Promise<T>,
  ): Promise<T> {
    const hit = await get(key, decode);
    if (hit !== null) return hit;
    const fresh = await load();
    await set(key, fresh, ttlSeconds);
    return fresh;
  }

  return { get, set, del, delByPrefix, getOrSet };
}

/** The process-wide cache, over the same single Redis connection as sessions. */
export const cache = createCache(redis, env.CACHE_ENABLED);
