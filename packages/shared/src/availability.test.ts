import { describe, expect, it } from 'vitest';
import {
  AVAILABILITY_PUBLIC_MAX_SLOTS,
  SLOT_MAX_ADVANCE_DAYS,
  SLOT_MAX_HOURS,
  SLOT_MIN_MINUTES,
  checkSlotTimes,
  createSlotSchema,
  durationMinutes,
} from './availability.js';

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
const at = (hoursFromNow: number): Date => new Date(NOW + hoursFromNow * 3_600_000);

describe('checkSlotTimes', () => {
  it('accepts a valid future slot', () => {
    expect(checkSlotTimes(at(24), at(25.5), NOW)).toBeNull();
  });

  it('rejects an end that is not after the start', () => {
    expect(checkSlotTimes(at(24), at(24), NOW)).toEqual({
      field: 'endsAt',
      message: expect.stringMatching(/after the start/i),
    });
    expect(checkSlotTimes(at(24), at(23), NOW)?.field).toBe('endsAt');
  });

  it(`rejects a slot longer than ${SLOT_MAX_HOURS} hours`, () => {
    expect(checkSlotTimes(at(24), at(24 + SLOT_MAX_HOURS + 0.5), NOW)?.field).toBe('endsAt');
    expect(checkSlotTimes(at(24), at(24 + SLOT_MAX_HOURS), NOW)).toBeNull(); // exactly at the limit
  });

  // M16 hardening: a slot floor stops a technician flooding the calendar with
  // thousands of tiny slots (which every public availability read would return).
  it(`rejects a slot shorter than ${SLOT_MIN_MINUTES} minutes`, () => {
    const startMs = 24 * 3_600_000;
    const belowMin = new Date(NOW + startMs + (SLOT_MIN_MINUTES - 1) * 60_000);
    expect(checkSlotTimes(at(24), belowMin, NOW)?.field).toBe('endsAt');
    const exactlyMin = new Date(NOW + startMs + SLOT_MIN_MINUTES * 60_000);
    expect(checkSlotTimes(at(24), exactlyMin, NOW)).toBeNull(); // exactly at the floor
  });

  it('rejects a start in the past or exactly now', () => {
    expect(checkSlotTimes(at(-1), at(1), NOW)?.field).toBe('startsAt');
    expect(checkSlotTimes(new Date(NOW), at(1), NOW)?.field).toBe('startsAt');
  });

  it(`rejects a start more than ${SLOT_MAX_ADVANCE_DAYS} days ahead`, () => {
    const tooFar = SLOT_MAX_ADVANCE_DAYS * 24 + 1;
    expect(checkSlotTimes(at(tooFar), at(tooFar + 1), NOW)?.field).toBe('startsAt');
  });
});

describe('constants', () => {
  it('bounds the public availability response and the slot floor', () => {
    expect(AVAILABILITY_PUBLIC_MAX_SLOTS).toBeGreaterThan(0);
    expect(AVAILABILITY_PUBLIC_MAX_SLOTS).toBeLessThanOrEqual(1000);
    expect(SLOT_MIN_MINUTES).toBeGreaterThanOrEqual(5);
  });
});

describe('durationMinutes', () => {
  it('computes whole minutes from Date or ISO string', () => {
    expect(durationMinutes(at(0), at(1))).toBe(60);
    expect(durationMinutes('2026-01-01T09:00:00.000Z', '2026-01-01T10:30:00.000Z')).toBe(90);
  });

  it('rounds to the nearest minute', () => {
    expect(durationMinutes(new Date(0), new Date(89_000))).toBe(1); // 89s → 1 min
    expect(durationMinutes(new Date(0), new Date(91_000))).toBe(2);
  });
});

describe('createSlotSchema', () => {
  const future = new Date(Date.now() + 48 * 3_600_000).toISOString();
  const later = new Date(Date.now() + 49 * 3_600_000).toISOString();

  it('accepts a well-formed body and coerces instants to Date', () => {
    const parsed = createSlotSchema.parse({
      serviceSlug: 'wifi-mesh-setup',
      startsAt: future,
      endsAt: later,
    });
    expect(parsed.startsAt).toBeInstanceOf(Date);
  });

  it('rejects mass-assignment keys (`.strict()`)', () => {
    expect(
      createSlotSchema.safeParse({
        serviceSlug: 'x',
        startsAt: future,
        endsAt: later,
        technicianId: 'sneaky',
      }).success,
    ).toBe(false);
  });

  it('surfaces the slot-time rule as a field error', () => {
    const result = createSlotSchema.safeParse({
      serviceSlug: 'x',
      startsAt: later,
      endsAt: future, // end before start
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['endsAt']);
    }
  });
});
