import { describe, expect, it } from 'vitest';
import {
  BOOKING_TRANSITIONS,
  bookingStatusValues,
  canActorTransition,
  createBookingSchema,
  isCustomerCancellable,
  isValidBookingTransition,
} from './booking.js';

describe('booking state machine', () => {
  it('matches the documented transitions exactly', () => {
    expect(BOOKING_TRANSITIONS).toEqual({
      pending: ['confirmed', 'rejected', 'cancelled'],
      confirmed: ['assigned', 'cancelled'],
      assigned: ['in_progress', 'cancelled'],
      in_progress: ['completed'],
      completed: [],
      cancelled: [],
      rejected: [],
    });
  });

  it('accepts documented transitions and rejects the rest', () => {
    expect(isValidBookingTransition('pending', 'confirmed')).toBe(true);
    expect(isValidBookingTransition('in_progress', 'completed')).toBe(true);
    expect(isValidBookingTransition('pending', 'completed')).toBe(false);
    expect(isValidBookingTransition('cancelled', 'pending')).toBe(false);
    expect(isValidBookingTransition('completed', 'cancelled')).toBe(false);
  });

  it('gates transitions by actor', () => {
    expect(canActorTransition('customer', 'pending', 'cancelled')).toBe(true);
    expect(canActorTransition('customer', 'confirmed', 'cancelled')).toBe(true);
    // a customer cannot confirm, assign, or complete
    expect(canActorTransition('customer', 'pending', 'confirmed')).toBe(false);
    expect(canActorTransition('customer', 'in_progress', 'completed')).toBe(false);
    // operations / technician rows exist for later milestones
    expect(canActorTransition('operations', 'pending', 'confirmed')).toBe(true);
    expect(canActorTransition('technician', 'assigned', 'in_progress')).toBe(true);
    expect(canActorTransition('technician', 'pending', 'cancelled')).toBe(false);
  });

  it('identifies customer-cancellable statuses', () => {
    expect(isCustomerCancellable('pending')).toBe(true);
    expect(isCustomerCancellable('confirmed')).toBe(true);
    expect(isCustomerCancellable('assigned')).toBe(true);
    expect(isCustomerCancellable('in_progress')).toBe(false);
    expect(isCustomerCancellable('completed')).toBe(false);
    expect(isCustomerCancellable('cancelled')).toBe(false);
  });

  it('covers every status value in the transition table', () => {
    for (const status of bookingStatusValues) {
      expect(BOOKING_TRANSITIONS[status]).toBeDefined();
    }
  });
});

describe('createBookingSchema', () => {
  it('accepts a minimal valid body', () => {
    const parsed = createBookingSchema.parse({
      slotId: 'clslot00000000000000000001',
      addressId: 'seed-address-alice-home',
    });
    expect(parsed.slotId).toBe('clslot00000000000000000001');
    expect(parsed.customerNotes).toBeUndefined();
  });

  it('trims and keeps customer notes', () => {
    const parsed = createBookingSchema.parse({
      slotId: 'clslot00000000000000000001',
      addressId: 'clADDR0000000000000000001',
      customerNotes: '  gate code 4321  ',
    });
    expect(parsed.customerNotes).toBe('gate code 4321');
  });

  it('rejects mass-assignment fields', () => {
    for (const extra of [
      { customerId: 'x' },
      { technicianId: 'x' },
      { serviceId: 'x' },
      { status: 'confirmed' },
      { scheduledStart: '2026-09-01T09:00:00.000Z' },
      { priceTotalCents: 1 },
      { price: { totalCents: 1 } },
    ]) {
      const result = createBookingSchema.safeParse({
        slotId: 'clslot00000000000000000001',
        addressId: 'clADDR0000000000000000001',
        ...extra,
      });
      expect(result.success, JSON.stringify(extra)).toBe(false);
    }
  });

  it('rejects malformed identifiers', () => {
    expect(
      createBookingSchema.safeParse({ slotId: 'short', addressId: 'clADDR0000000000000000001' })
        .success,
    ).toBe(false);
    expect(
      createBookingSchema.safeParse({
        slotId: 'has spaces here',
        addressId: 'clADDR0000000000000000001',
      }).success,
    ).toBe(false);
  });
});
