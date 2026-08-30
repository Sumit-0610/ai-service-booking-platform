import type { RequestHandler } from 'express';
import { loginInputSchema, registerInputSchema } from '@aisbp/shared';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { clearSession, issueSession, refreshCsrfCookie } from '../session/session-cookies.js';
import { authService } from './auth-service.js';

/** Controllers stay thin: validate input, call the service, shape the response. */

const register: RequestHandler = async (req, res) => {
  const input = registerInputSchema.parse(req.body);
  const user = await authService.register(input);
  await issueSession(res, {
    userId: user.id,
    role: user.role,
    previousSessionId: req.cookies?.[env.SESSION_COOKIE_NAME] as string | undefined,
  });
  res.status(201).json({ user });
};

const login: RequestHandler = async (req, res) => {
  const input = loginInputSchema.parse(req.body);
  const user = await authService.verifyCredentials(input.email, input.password);
  await issueSession(res, {
    userId: user.id,
    role: user.role,
    previousSessionId: req.cookies?.[env.SESSION_COOKIE_NAME] as string | undefined,
  });
  res.status(200).json({ user });
};

const logout: RequestHandler = async (req, res) => {
  await clearSession(res, req.session?.id);
  res.status(204).end();
};

const me: RequestHandler = async (req, res) => {
  if (!req.user || !req.session) {
    throw new AppError('UNAUTHENTICATED', 'Authentication required');
  }
  const user = await authService.loadUser(req.user.id);
  if (!user) {
    await clearSession(res, req.session.id);
    throw new AppError('UNAUTHENTICATED', 'Authentication required');
  }
  refreshCsrfCookie(res, req.session.csrfToken);
  res.status(200).json({ user });
};

export const authController = { register, login, logout, me };
