import { describe, expect, it } from 'vitest';
import { AvailabilitySlotStatus, BookingStatus, Role } from '../../generated/prisma/index.js';

/**
 * Locks the generated enums to the tokens used across the docs and the API
 * contract. Runs without a database.
 */
describe('generated domain enums', () => {
  it('matches the documented booking states', () => {
    expect(Object.values(BookingStatus).sort()).toEqual(
      [
        'pending',
        'confirmed',
        'assigned',
        'in_progress',
        'completed',
        'cancelled',
        'rejected',
      ].sort(),
    );
  });

  it('matches the documented roles', () => {
    expect(Object.values(Role).sort()).toEqual(['customer', 'operations', 'technician'].sort());
  });

  it('matches the documented availability slot states', () => {
    expect(Object.values(AvailabilitySlotStatus).sort()).toEqual(
      ['available', 'held', 'booked', 'unavailable'].sort(),
    );
  });
});
