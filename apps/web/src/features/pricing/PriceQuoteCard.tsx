import type { ReactElement } from 'react';
import { calculateServicePrice, formatPrice } from '@aisbp/shared';

interface PriceQuoteCardProps {
  /** The authoritative current price, already loaded with the service detail —
   * no extra request is made just to show pricing. */
  priceCents: number;
  currency: string;
}

/**
 * Renders the service price through the shared pricing domain contract
 * (`calculateServicePrice`), so the detail page shows exactly the quote the
 * future booking workflow will consume. Fees / tax / discount are always zero
 * in the MVP, so only non-zero components are listed.
 */
export function PriceQuoteCard({ priceCents, currency }: PriceQuoteCardProps): ReactElement {
  const quote = calculateServicePrice({ basePriceCents: priceCents, currency });
  const extraLines = [
    { label: 'Fees', amountCents: quote.feesTotalCents },
    { label: 'Tax', amountCents: quote.taxTotalCents },
    { label: 'Discount', amountCents: -quote.discountTotalCents },
  ].filter((line) => line.amountCents !== 0);

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6" aria-label="Pricing">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Pricing</h2>
      <dl className="mt-3 space-y-1.5 text-sm text-slate-700">
        {quote.breakdown.lines.map((line) => (
          <div key={line.label} className="flex items-baseline justify-between gap-4">
            <dt>{line.label}</dt>
            <dd className="tabular-nums">{formatPrice(line.amountCents, quote.currency)}</dd>
          </div>
        ))}
        {extraLines.map((line) => (
          <div key={line.label} className="flex items-baseline justify-between gap-4">
            <dt>{line.label}</dt>
            <dd className="tabular-nums">{formatPrice(line.amountCents, quote.currency)}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatPrice(quote.totalCents, quote.currency)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-slate-500">
        This is the full service price. The final price is locked in when you book — online booking
        isn&apos;t available yet.
      </p>
    </section>
  );
}
