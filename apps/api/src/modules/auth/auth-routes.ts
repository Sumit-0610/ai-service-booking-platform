import { Router } from 'express';
import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { requireCsrf } from '../../middleware/csrf.js';
import { emailKey, ipKey, rateLimit } from '../../middleware/rate-limit.js';
import { authController } from './auth-controller.js';

const loginRateLimitByIp = rateLimit({
  keyPrefix: 'login:ip',
  max: env.LOGIN_RATE_LIMIT_MAX,
  windowSeconds: env.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
  keyFor: ipKey,
});

const loginRateLimitByEmail = rateLimit({
  keyPrefix: 'login:email',
  max: env.LOGIN_RATE_LIMIT_MAX,
  windowSeconds: env.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
  keyFor: emailKey,
});

const registerRateLimitByIp = rateLimit({
  keyPrefix: 'register:ip',
  max: env.REGISTER_RATE_LIMIT_MAX,
  windowSeconds: env.REGISTER_RATE_LIMIT_WINDOW_SECONDS,
  keyFor: ipKey,
});

export const authRouter = Router();

authRouter.post('/register', registerRateLimitByIp, authController.register);
authRouter.post('/login', loginRateLimitByIp, loginRateLimitByEmail, authController.login);
authRouter.post('/logout', requireAuth, requireCsrf, authController.logout);
authRouter.get('/me', requireAuth, authController.me);
