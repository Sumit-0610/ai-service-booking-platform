import { describe, expect, it } from 'vitest';
import {
  aiAvailabilityRequestSchema,
  aiBookingIntentSchema,
  aiClarifyRequestSchema,
  aiIntentRequestSchema,
  missingIntentFields,
} from './ai.js';

const validIntent = {
  serviceSlug: 'washing-machine-installation',
  serviceCandidateSlugs: ['dishwasher-installation'],
  requestedDate: '2099-01-15',
  requestedTimeOfDay: 'morning',
  addressId: 'addr-1',
  notes: null,
  missingFields: [],
  clarificationQuestion: null,
  confidence: 'high',
};

describe('aiBookingIntentSchema', () => {
  it('accepts a well-formed intent', () => {
    expect(aiBookingIntentSchema.parse(validIntent)).toMatchObject({
      serviceSlug: 'washing-machine-installation',
    });
  });

  it('rejects a bad date, enum, or missing field', () => {
    expect(
      aiBookingIntentSchema.safeParse({ ...validIntent, requestedDate: '15/01/2099' }).success,
    ).toBe(false);
    expect(aiBookingIntentSchema.safeParse({ ...validIntent, confidence: 'certain' }).success).toBe(
      false,
    );
    expect(
      aiBookingIntentSchema.safeParse({ ...validIntent, missingFields: ['price'] }).success,
    ).toBe(false);
    const { serviceSlug: _omit, ...withoutService } = validIntent;
    expect(aiBookingIntentSchema.safeParse(withoutService).success).toBe(false);
  });

  it('allows nulls for the optional slots', () => {
    expect(
      aiBookingIntentSchema.parse({
        ...validIntent,
        serviceSlug: null,
        requestedDate: null,
        requestedTimeOfDay: null,
        addressId: null,
      }).serviceSlug,
    ).toBeNull();
  });
});

describe('missingIntentFields', () => {
  it('reports each absent field in order', () => {
    expect(
      missingIntentFields({ serviceSlug: null, requestedDate: null, addressId: null }),
    ).toEqual(['service', 'date', 'address']);
    expect(
      missingIntentFields({ serviceSlug: 's', requestedDate: '2099-01-01', addressId: 'a' }),
    ).toEqual([]);
    expect(missingIntentFields({ serviceSlug: 's', requestedDate: null, addressId: 'a' })).toEqual([
      'date',
    ]);
  });
});

describe('request bodies', () => {
  it('aiIntentRequestSchema is strict and bounded', () => {
    expect(aiIntentRequestSchema.parse({ message: '  hi  ' }).message).toBe('hi');
    expect(aiIntentRequestSchema.safeParse({ message: '' }).success).toBe(false);
    expect(aiIntentRequestSchema.safeParse({ message: 'x'.repeat(2001) }).success).toBe(false);
    expect(aiIntentRequestSchema.safeParse({ message: 'hi', role: 'admin' }).success).toBe(false);
  });

  it('aiClarifyRequestSchema requires a well-formed priorIntent', () => {
    expect(
      aiClarifyRequestSchema.safeParse({ message: 'more', priorIntent: validIntent }).success,
    ).toBe(true);
    expect(
      aiClarifyRequestSchema.safeParse({ message: 'more', priorIntent: { confidence: 'x' } })
        .success,
    ).toBe(false);
  });

  it('aiAvailabilityRequestSchema validates the slug shape', () => {
    expect(aiAvailabilityRequestSchema.safeParse({ serviceSlug: 'wifi-mesh-setup' }).success).toBe(
      true,
    );
    expect(aiAvailabilityRequestSchema.safeParse({ serviceSlug: 'Bad Slug' }).success).toBe(false);
    expect(
      aiAvailabilityRequestSchema.safeParse({ serviceSlug: 'wifi-mesh-setup', from: 'not-a-date' })
        .success,
    ).toBe(false);
  });
});
