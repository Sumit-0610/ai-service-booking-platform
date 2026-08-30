import type { Request, RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import { redis } from '../lib/redis.js';

interface RateLimitOptions {
  /** Namespace for the Redis key, e.g. `login:ip`. */
  keyPrefix: string;
  /** Max requests allowed per window. */
  max: number;
  windowSeconds: number;
  /** Derives the per-caller key (IP, email, ...). */
  keyFor: (req: Request) => string;
}

/**
 * Fixed-window rate limiter backed by Redis. Deliberately simple: `INCR` the
 * counter, set the TTL on first hit, reject once the count exceeds `max`.
 * Good enough to blunt brute-force login and signup abuse for the MVP.
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  return async (req, res, next) => {
    const identifier = options.keyFor(req) || 'unknown';
    const key = `rl:${options.keyPrefix}:${identifier}`;

    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, options.windowSeconds);
    }

    res.setHeader('X-RateLimit-Limit', String(options.max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, options.max - count)));

    if (count > options.max) {
      const ttl = await redis.ttl(key);
      res.setHeader('Retry-After', String(Math.max(1, ttl)));
      next(new AppError('RATE_LIMITED', 'Too many attempts. Please try again later.'));
      return;
    }

    next();
  };
}

export const ipKey = (req: Request): string => req.ip ?? 'unknown';

export const emailKey = (req: Request): string => {
  const raw = (req.body as { email?: unknown } | undefined)?.email;
  return typeof raw === 'string' ? raw.trim().toLowerCase() : 'unknown';
};
