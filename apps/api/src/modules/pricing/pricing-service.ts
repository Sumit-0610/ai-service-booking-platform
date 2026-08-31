import { repositories } from '@aisbp/database';
import { calculateServicePrice, type PriceQuote } from '@aisbp/shared';
import { AppError } from '../../lib/errors.js';

/**
 * Pricing sits between the current `Service` list price and the future booking
 * snapshot:
 *
 *   Service.basePriceCents  ->  pricingService  ->  PriceQuote  ->  (M9) Booking
 *
 * It reads the authoritative price from the database and runs the pure
 * `calculateServicePrice` domain function. It never writes anything — the
 * booking workflow will persist the immutable snapshot inside its own
 * transaction.
 */
export const pricingService = {
  async quoteForServiceSlug(slug: string): Promise<PriceQuote> {
    const service = await repositories.catalog.findActivePriceBySlug(slug);
    if (!service) {
      throw new AppError('NOT_FOUND', 'Service not found');
    }

    return calculateServicePrice({
      basePriceCents: service.basePriceCents,
      currency: service.currency,
    });
  },
};
