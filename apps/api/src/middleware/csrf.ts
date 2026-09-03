import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Constant-time string compare — no early return on the first differing byte. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * CSRF protection for state-changing, cookie-authenticated requests. Must run
 * after `requireAuth`. Uses a synchronizer token: the client sends the value of
 * the readable CSRF cookie back in `X-CSRF-Token`, and it must match the token
 * stored server-side in the session. The comparison is constant-time
 * (Milestone 16 hardening).
 */
export const requireCsrf: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const headerToken = req.get('x-csrf-token');
  if (!req.session || !headerToken || !safeEqual(headerToken, req.session.csrfToken)) {
    next(new AppError('CSRF_ERROR', 'Invalid or missing CSRF token'));
    return;
  }

  next();
};
