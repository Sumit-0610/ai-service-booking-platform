import { Router } from 'express';
import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/authorize.js';
import { requireCsrf } from '../../middleware/csrf.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { aiController } from './ai-controller.js';

/**
 * Claude AI Booking Assistant (Milestone 14). Customer role only — the
 * assistant helps a customer prepare a booking; operations and technicians get
 * `403`. Every request is authenticated, CSRF-protected (it triggers a paid
 * external call), and rate-limited per user. Mounted at
 * `/api/v1/ai/booking-assistant`.
 *
 * These endpoints never mutate data: they return a draft intent or an
 * availability summary. Booking creation still goes through
 * `POST /api/v1/bookings` with its own transaction and validation.
 */
const aiRateLimit = rateLimit({
  keyPrefix: 'ai',
  max: env.AI_RATE_LIMIT_MAX,
  windowSeconds: env.AI_RATE_LIMIT_WINDOW_SECONDS,
  keyFor: (req) => req.user?.id ?? 'anon',
});

export const aiAssistantRouter = Router();
aiAssistantRouter.use(requireAuth, requireRole('customer'), aiRateLimit);
aiAssistantRouter.post('/intent', requireCsrf, aiController.extractIntent);
aiAssistantRouter.post('/clarify', requireCsrf, aiController.clarifyIntent);
aiAssistantRouter.post('/availability', requireCsrf, aiController.assistAvailability);
