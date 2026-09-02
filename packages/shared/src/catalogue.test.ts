import { describe, expect, it } from 'vitest';
import { catalogueQuerySchema, formatDuration, formatPrice } from './catalogue.js';

describe('formatPrice', () => {
  it('formats integer cents as a currency string', () => {
    expect(formatPrice(8900, 'USD')).toBe('$89.00');
    expect(formatPrice(0, 'USD')).toBe('$0.00');
    expect(formatPrice(123456, 'EUR')).toContain('1,234.56');
  });

  it('falls back gracefully for an unknown currency code', () => {
    const formatted = formatPrice(1050, 'ZZZ');
    expect(formatted).toContain('10.50');
    expect(formatted).toContain('ZZZ');
  });
});

describe('formatDuration', () => {
  it('renders minutes, whole hours, and hours + minutes', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(60)).toBe('1 hr');
    expect(formatDuration(90)).toBe('1 hr 30 min');
    expect(formatDuration(150)).toBe('2 hr 30 min');
  });
});

describe('catalogueQuerySchema', () => {
  it('applies defaults and treats blank text as absent', () => {
    expect(catalogueQuerySchema.parse({})).toMatchObject({ sort: 'name_asc', page: 1, limit: 12 });
    expect(catalogueQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
  });

  it('bounds page and limit, and closes the sort enum', () => {
    expect(catalogueQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(catalogueQuerySchema.safeParse({ limit: '49' }).success).toBe(false);
    expect(catalogueQuerySchema.safeParse({ sort: 'cheapest' }).success).toBe(false);
    expect(catalogueQuerySchema.parse({ page: '3', limit: '24' })).toMatchObject({
      page: 3,
      limit: 24,
    });
  });

  it('ignores unknown keys rather than rejecting them', () => {
    const parsed = catalogueQuerySchema.parse({ where: 'x', select: 'password' } as Record<
      string,
      unknown
    >);
    expect(parsed).not.toHaveProperty('where');
  });
});
