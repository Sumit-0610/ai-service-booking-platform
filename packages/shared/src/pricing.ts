import { z } from 'zod';

/**
 * Shared contracts for service pricing (Milestone 8).
 *
 * Money is always an integer number of minor units ("cents"). There is no
 * floating-point arithmetic anywhere in pricing: `1050` means $10.50. The
 * server is the sole authority on every monetary figure — a client may name a
 * service, never a price.
 *
 * The MVP has exactly one rule: the quote equals the service's current list
 * price. `fees`, `discount`, and `tax` are structurally present so the booking
 * snapshot and the CHECK constraint stay satisfied, but they are always zero —
 * the product has defined no business rules for them yet. Percentage-based
 * components (and the rounding rules they would need) are deliberately out of
 * scope.
 */

/**
 * A service slug as it appears in a URL path: lowercase alphanumerics in
 * hyphen-separated groups (e.g. `washing-machine-installation`). A malformed
 * slug is a validation error (422), distinct from a well-formed slug that
 * matches no active service (404).
 */
export const serviceSlugParamSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Invalid service slug'),
});
export type ServiceSlugParam = z.infer<typeof serviceSlugParamSchema>;

/** A single explainable line in a price breakdown. */
export const priceBreakdownLineSchema = z.object({
  label: z.string(),
  amountCents: z.number().int(),
});
export type PriceBreakdownLine = z.infer<typeof priceBreakdownLineSchema>;

/** Simple, explainable breakdown. Not a rules-engine DSL. */
export const priceBreakdownSchema = z.object({
  lines: z.array(priceBreakdownLineSchema),
});
export type PriceBreakdown = z.infer<typeof priceBreakdownSchema>;

/** The explicit price quote DTO returned by the pricing API. */
export const priceQuoteSchema = z.object({
  currency: z.string(),
  subtotalCents: z.number().int().nonnegative(),
  feesTotalCents: z.number().int().nonnegative(),
  discountTotalCents: z.number().int().nonnegative(),
  taxTotalCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
  breakdown: priceBreakdownSchema,
});
export type PriceQuote = z.infer<typeof priceQuoteSchema>;

export const priceQuoteResponseSchema = z.object({ quote: priceQuoteSchema });
export type PriceQuoteResponse = z.infer<typeof priceQuoteResponseSchema>;

/** The only input the pure calculation needs — both fields come from the
 * authoritative `Service` record, never from the client. */
export interface PriceCalculationInput {
  basePriceCents: number;
  currency: string;
}

/**
 * Deterministic, pure, integer-only. Given a service's current list price it
 * returns the full quote. No database access, no HTTP concerns, no clock.
 *
 * Invariant (matches the PostgreSQL `booking_price_total_consistent` CHECK):
 *   totalCents = subtotalCents + feesTotalCents + taxTotalCents - discountTotalCents
 */
export function calculateServicePrice(input: PriceCalculationInput): PriceQuote {
  if (!Number.isInteger(input.basePriceCents) || input.basePriceCents < 0) {
    throw new RangeError('basePriceCents must be a non-negative integer number of cents');
  }

  const subtotalCents = input.basePriceCents;
  const feesTotalCents = 0;
  const discountTotalCents = 0;
  const taxTotalCents = 0;
  const totalCents = subtotalCents + feesTotalCents + taxTotalCents - discountTotalCents;

  return {
    currency: input.currency,
    subtotalCents,
    feesTotalCents,
    discountTotalCents,
    taxTotalCents,
    totalCents,
    breakdown: { lines: [{ label: 'Service', amountCents: subtotalCents }] },
  };
}
