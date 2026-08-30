import { randomBytes } from 'node:crypto';
import type { Role } from '@aisbp/shared';
import { env } from '../../config/env.js';
import { redis } from '../../lib/redis.js';

/**
 * Redis-backed session storage. This is the only place session keys are read or
 * written; middleware and controllers call these methods, never Redis directly.
 */

const SESSION_PREFIX = 'sess:';

export interface SessionData {
  userId: string;
  role: Role;
  csrfToken: string;
  createdAt: string;
}

function randomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

export const sessionStore = {
  /** Create a brand-new session (fresh id + fresh CSRF token). */
  async create(input: {
    userId: string;
    role: Role;
  }): Promise<{ sessionId: string; session: SessionData }> {
    const sessionId = randomToken();
    const session: SessionData = {
      userId: input.userId,
      role: input.role,
      csrfToken: randomToken(),
      createdAt: new Date().toISOString(),
    };
    await redis.set(
      SESSION_PREFIX + sessionId,
      JSON.stringify(session),
      'EX',
      env.SESSION_TTL_SECONDS,
    );
    return { sessionId, session };
  },

  async get(sessionId: string): Promise<SessionData | null> {
    if (!sessionId) {
      return null;
    }
    const raw = await redis.get(SESSION_PREFIX + sessionId);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as SessionData;
    } catch {
      return null;
    }
  },

  /** Sliding expiration: extend the TTL on activity. */
  async touch(sessionId: string): Promise<void> {
    if (!sessionId) {
      return;
    }
    await redis.expire(SESSION_PREFIX + sessionId, env.SESSION_TTL_SECONDS);
  },

  async destroy(sessionId: string): Promise<void> {
    if (!sessionId) {
      return;
    }
    await redis.del(SESSION_PREFIX + sessionId);
  },
};
