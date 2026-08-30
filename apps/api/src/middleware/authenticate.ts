import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { sessionStore } from '../modules/session/session-store.js';

/**
 * Loads the session from the HttpOnly cookie and attaches `req.user` /
 * `req.session`. Rejects with 401 when there is no valid session. Refreshes the
 * session TTL on every authenticated request (sliding expiration).
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const sessionId = req.cookies?.[env.SESSION_COOKIE_NAME] as string | undefined;
  const session = sessionId ? await sessionStore.get(sessionId) : null;

  if (!sessionId || !session) {
    next(new AppError('UNAUTHENTICATED', 'Authentication required'));
    return;
  }

  req.session = {
    id: sessionId,
    userId: session.userId,
    role: session.role,
    csrfToken: session.csrfToken,
  };
  req.user = { id: session.userId, role: session.role };

  await sessionStore.touch(sessionId);
  next();
};
