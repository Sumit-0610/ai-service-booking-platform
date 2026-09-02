import type { Request, RequestHandler } from 'express';
import {
  aiAvailabilityRequestSchema,
  aiClarifyRequestSchema,
  aiIntentRequestSchema,
} from '@aisbp/shared';
import { AppError } from '../../lib/errors.js';
import { aiService } from './ai-service.js';

/** Thin: validate the body, resolve the caller, call the service, return the DTO. */

function customerId(req: Request): string {
  if (!req.user) {
    throw new AppError('UNAUTHENTICATED', 'Authentication required');
  }
  return req.user.id;
}

const extractIntent: RequestHandler = async (req, res) => {
  const { message } = aiIntentRequestSchema.parse(req.body);
  res.status(200).json(await aiService.extractIntent(customerId(req), message));
};

const clarifyIntent: RequestHandler = async (req, res) => {
  const { message, priorIntent } = aiClarifyRequestSchema.parse(req.body);
  res.status(200).json(await aiService.clarifyIntent(customerId(req), message, priorIntent));
};

const assistAvailability: RequestHandler = async (req, res) => {
  const input = aiAvailabilityRequestSchema.parse(req.body);
  res.status(200).json(await aiService.assistAvailability(customerId(req), input));
};

export const aiController = { extractIntent, clarifyIntent, assistAvailability };
