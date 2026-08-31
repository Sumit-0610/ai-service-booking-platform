import { describe, expect, it } from 'vitest';
import { calculateServicePrice, priceQuoteSchema } from './pricing.js';

describe('calculateServicePrice', () => {
  it('makes the base price the subtotal', () => {
    const quote = calculateServicePrice({ basePriceCents: 10_000, currency: 'USD' });
    expect(quote.subtotalCents).toBe(10_000);
  });

  it('keeps fees, discount and tax at zero for the MVP', () => {
    const quote = calculateServicePrice({ basePriceCents: 8_900, currency: 'USD' });
    expect(quote.feesTotalCents).toBe(0);
    expect(quote.discountTotalCents).toBe(0);
    expect(quote.taxTotalCents).toBe(0);
  });

  it('makes the total equal the subtotal', () => {
    const quote = calculateServicePrice({ basePriceCents: 12_345, currency: 'USD' });
    expect(quote.totalCents).toBe(quote.subtotalCents);
  });

  it('satisfies the booking price-consistency invariant', () => {
    const quote = calculateServicePrice({ basePriceCents: 7_777, currency: 'EUR' });
    expect(quote.totalCents).toBe(
      quote.subtotalCents + quote.feesTotalCents + quote.taxTotalCents - quote.discountTotalCents,
    );
  });

  it('preserves integer cents exactly (no floating point)', () => {
    for (const cents of [1, 99, 100, 1_050, 999_999, 2_500_00]) {
      const quote = calculateServicePrice({ basePriceCents: cents, currency: 'USD' });
      expect(Number.isInteger(quote.totalCents)).toBe(true);
      expect(quote.totalCents).toBe(cents);
    }
  });

  it('handles a zero price', () => {
    const quote = calculateServicePrice({ basePriceCents: 0, currency: 'USD' });
    expect(quote.subtotalCents).toBe(0);
    expect(quote.totalCents).toBe(0);
    expect(quote.breakdown.lines).toEqual([{ label: 'Service', amountCents: 0 }]);
  });

  it('produces a deterministic breakdown', () => {
    const a = calculateServicePrice({ basePriceCents: 4_200, currency: 'USD' });
    const b = calculateServicePrice({ basePriceCents: 4_200, currency: 'USD' });
    expect(a).toEqual(b);
    expect(a.breakdown).toEqual({ lines: [{ label: 'Service', amountCents: 4_200 }] });
  });

  it('preserves the currency it was given', () => {
    expect(calculateServicePrice({ basePriceCents: 100, currency: 'GBP' }).currency).toBe('GBP');
    expect(calculateServicePrice({ basePriceCents: 100, currency: 'INR' }).currency).toBe('INR');
  });

  it('returns a value that matches the public quote schema', () => {
    const quote = calculateServicePrice({ basePriceCents: 15_000, currency: 'USD' });
    expect(() => priceQuoteSchema.parse(quote)).not.toThrow();
  });

  it('rejects a non-integer or negative base price', () => {
    expect(() => calculateServicePrice({ basePriceCents: 10.5, currency: 'USD' })).toThrow(
      RangeError,
    );
    expect(() => calculateServicePrice({ basePriceCents: -1, currency: 'USD' })).toThrow(
      RangeError,
    );
  });
});
