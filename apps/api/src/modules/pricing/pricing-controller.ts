import type { RequestHandler } from 'express';
import { serviceSlugParamSchema } from '@aisbp/shared';
import { pricingService } from './pricing-service.js';

/** Thin: validate the slug, ask the pricing service, return the quote DTO. */
const getServiceQuote: RequestHandler = async (req, res) => {
  const { slug } = serviceSlugParamSchema.parse(req.params);
  const quote = await pricingService.quoteForServiceSlug(slug);
  res.status(200).json({ quote });
};

export const pricingController = { getServiceQuote };
