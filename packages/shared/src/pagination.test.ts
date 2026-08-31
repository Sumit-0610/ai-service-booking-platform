import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { pageOffset, pageParams, paginationMeta } from './pagination.js';

describe('pageParams', () => {
  const schema = z.object({ ...pageParams({ defaultLimit: 10, maxLimit: 50 }) });

  it('applies defaults and coerces strings', () => {
    expect(schema.parse({})).toEqual({ page: 1, limit: 10 });
    expect(schema.parse({ page: '3', limit: '25' })).toEqual({ page: 3, limit: 25 });
  });

  it('rejects out-of-range and malformed values (no clamping)', () => {
    for (const q of [
      { page: '0' },
      { page: '-1' },
      { limit: '0' },
      { limit: '51' },
      { limit: 'abc' },
    ]) {
      expect(schema.safeParse(q).success, JSON.stringify(q)).toBe(false);
    }
    expect(schema.safeParse({ page: '10001' }).success).toBe(false);
  });
});

describe('paginationMeta', () => {
  it('computes totalPages and the boundary flags', () => {
    expect(paginationMeta(1, 10, 0)).toEqual({
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
    });
    expect(paginationMeta(1, 10, 25)).toMatchObject({
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: false,
    });
    expect(paginationMeta(3, 10, 25)).toMatchObject({ hasNextPage: false, hasPreviousPage: true });
    expect(paginationMeta(5, 10, 25)).toMatchObject({
      totalPages: 3,
      hasNextPage: false,
      hasPreviousPage: true,
    });
  });
});

describe('pageOffset', () => {
  it('is zero-based', () => {
    expect(pageOffset(1, 20)).toBe(0);
    expect(pageOffset(3, 20)).toBe(40);
  });
});
