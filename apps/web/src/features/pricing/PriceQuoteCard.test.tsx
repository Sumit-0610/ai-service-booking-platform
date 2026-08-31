import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PriceQuoteCard } from './PriceQuoteCard';

describe('PriceQuoteCard', () => {
  it('shows the service line and total from the pricing contract', () => {
    render(<PriceQuoteCard priceCents={10_000} currency="USD" />);

    const section = screen.getByRole('region', { name: /pricing/i });
    expect(within(section).getByText('Service')).toBeInTheDocument();
    expect(within(section).getAllByText('$100.00')).toHaveLength(2); // service line + total
    expect(within(section).getByText('Total')).toBeInTheDocument();
  });

  it('does not render zero fee / tax / discount lines', () => {
    render(<PriceQuoteCard priceCents={8_900} currency="USD" />);
    const section = screen.getByRole('region', { name: /pricing/i });
    expect(within(section).queryByText('Fees')).not.toBeInTheDocument();
    expect(within(section).queryByText('Tax')).not.toBeInTheDocument();
    expect(within(section).queryByText('Discount')).not.toBeInTheDocument();
  });

  it('handles a zero price', () => {
    render(<PriceQuoteCard priceCents={0} currency="USD" />);
    const section = screen.getByRole('region', { name: /pricing/i });
    expect(within(section).getAllByText('$0.00')).toHaveLength(2);
  });

  it('respects the service currency', () => {
    render(<PriceQuoteCard priceCents={12_000} currency="GBP" />);
    expect(screen.getAllByText('£120.00').length).toBeGreaterThan(0);
  });

  it('states that booking is not available yet', () => {
    render(<PriceQuoteCard priceCents={5_000} currency="USD" />);
    expect(screen.getByText(/online booking isn.?t available yet/i)).toBeInTheDocument();
  });
});
