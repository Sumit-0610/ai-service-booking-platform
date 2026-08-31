import { describe, expect, it } from 'vitest';
import {
  operationsBookingsQuerySchema,
  operationsStatusTargetSchema,
  updateBookingStatusSchema,
} from './operations.js';

describe('operationsBookingsQuerySchema', () => {
  it('applies defaults', () => {
    const parsed = operationsBookingsQuerySchema.parse({});
    expect(parsed).toMatchObject({ sort: 'created_desc', page: 1, limit: 20 });
    expect(parsed.status).toBeUndefined();
  });

  it('coerces page/limit and rejects out-of-range values', () => {
    expect(operationsBookingsQuerySchema.parse({ page: '2', limit: '50' })).toMatchObject({
      page: 2,
      limit: 50,
    });
    expect(operationsBookingsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(operationsBookingsQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(operationsBookingsQuerySchema.safeParse({ limit: 'abc' }).success).toBe(false);
  });

  it('accepts a known status and rejects an unknown one', () => {
    expect(operationsBookingsQuerySchema.parse({ status: 'confirmed' }).status).toBe('confirmed');
    expect(operationsBookingsQuerySchema.safeParse({ status: 'nonsense' }).success).toBe(false);
  });

  it('ignores unknown parameters (no arbitrary filters)', () => {
    const parsed = operationsBookingsQuerySchema.parse({
      where: 'x',
      select: 'passwordHash',
      customerId: 'y',
    } as Record<string, unknown>);
    expect(parsed).not.toHaveProperty('where');
    expect(parsed).not.toHaveProperty('customerId');
  });

  it('treats blank date bounds as absent and parses valid ones', () => {
    expect(operationsBookingsQuerySchema.parse({ from: '' }).from).toBeUndefined();
    const parsed = operationsBookingsQuerySchema.parse({ from: '2026-09-01T00:00:00.000Z' });
    expect(parsed.from).toBeInstanceOf(Date);
    expect(operationsBookingsQuerySchema.safeParse({ from: 'not-a-date' }).success).toBe(false);
  });
});

describe('updateBookingStatusSchema', () => {
  it('accepts the three operations targets with an optional reason', () => {
    for (const status of operationsStatusTargetSchema.options) {
      expect(updateBookingStatusSchema.parse({ status }).status).toBe(status);
    }
    expect(
      updateBookingStatusSchema.parse({ status: 'cancelled', reason: '  double booked ' }),
    ).toEqual({ status: 'cancelled', reason: 'double booked' });
  });

  it('rejects statuses an operator may not set directly', () => {
    for (const status of ['assigned', 'pending', 'in_progress', 'completed']) {
      expect(updateBookingStatusSchema.safeParse({ status }).success, status).toBe(false);
    }
  });

  it('rejects mass-assignment fields', () => {
    for (const extra of [
      { technicianId: 'x' },
      { priceTotalCents: 1 },
      { customerId: 'y' },
      { changedByUserId: 'z' },
    ]) {
      expect(updateBookingStatusSchema.safeParse({ status: 'confirmed', ...extra }).success).toBe(
        false,
      );
    }
  });
});
