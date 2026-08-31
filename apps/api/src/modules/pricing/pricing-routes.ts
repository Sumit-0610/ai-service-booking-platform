import { Router } from 'express';
import { pricingController } from './pricing-controller.js';

/**
 * Public pricing. No authentication — an authenticated customer gets the same
 * quote. Mounted at /api/v1.
 */
export const pricingRouter = Router();
pricingRouter.get('/services/:slug/price', pricingController.getServiceQuote);
