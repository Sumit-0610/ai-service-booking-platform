import type { Response } from 'express';
import type { Role } from '@aisbp/shared';
import { env } from '../../config/env.js';
import { sessionStore } from './session-store.js';

/**
 * Translates the session abstraction into HTTP cookies. Controllers call these
 * so cookie flags live in exactly one place.
 *
 * - Session cookie: HttpOnly (never readable by JS), so it cannot be stolen by
 *   XSS or stored in localStorage.
 * - CSRF cookie: readable by JS on purpose — the SPA echoes it back in the
 *   `X-CSRF-Token` header (double-submit), and the server also checks it
 *   against the token stored in the session.
 * - SameSite=Lax: sent on same-site requests (the SPA and API share a site) and
 *   top-level navigations, but not on cross-site sub-requests.
 */

const baseCookieOptions = {
  path: '/',
  sameSite: 'lax' as const,
  secure: env.COOKIE_SECURE,
};

const maxAgeMs = env.SESSION_TTL_SECONDS * 1000;

export async function issueSession(
  res: Response,
  input: { userId: string; role: Role; previousSessionId?: string | undefined },
): Promise<void> {
  // Session fixation defence: abandon any pre-existing session, mint a new id.
  if (input.previousSessionId) {
    await sessionStore.destroy(input.previousSessionId);
  }

  const { sessionId, session } = await sessionStore.create({
    userId: input.userId,
    role: input.role,
  });

  res.cookie(env.SESSION_COOKIE_NAME, sessionId, {
    ...baseCookieOptions,
    httpOnly: true,
    maxAge: maxAgeMs,
  });
  res.cookie(env.CSRF_COOKIE_NAME, session.csrfToken, {
    ...baseCookieOptions,
    httpOnly: false,
    maxAge: maxAgeMs,
  });
}

export async function clearSession(res: Response, sessionId?: string | undefined): Promise<void> {
  if (sessionId) {
    await sessionStore.destroy(sessionId);
  }
  res.clearCookie(env.SESSION_COOKIE_NAME, baseCookieOptions);
  res.clearCookie(env.CSRF_COOKIE_NAME, baseCookieOptions);
}

export function refreshCsrfCookie(res: Response, csrfToken: string): void {
  res.cookie(env.CSRF_COOKIE_NAME, csrfToken, {
    ...baseCookieOptions,
    httpOnly: false,
    maxAge: maxAgeMs,
  });
}
