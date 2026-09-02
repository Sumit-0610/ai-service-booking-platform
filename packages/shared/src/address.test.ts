import { describe, expect, it } from 'vitest';
import {
  countrySchema,
  createAddressSchema,
  formatAddress,
  updateAddressSchema,
} from './address.js';

const VALID = {
  label: 'Home',
  line1: '12 MG Road',
  line2: 'Near the park',
  city: 'Pune',
  state: 'Maharashtra',
  postalCode: '411001',
  country: 'IN',
};

describe('countrySchema', () => {
  it('trims and upper-cases a 2-letter code', () => {
    expect(countrySchema.parse(' in ')).toBe('IN');
  });
  it('rejects anything that is not two letters', () => {
    for (const bad of ['USA', 'i', '12', '']) {
      expect(countrySchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('createAddressSchema', () => {
  it('accepts a valid body and normalises an empty line2 to null', () => {
    expect(createAddressSchema.parse({ ...VALID, line2: '   ' }).line2).toBeNull();
    expect(createAddressSchema.parse(VALID).country).toBe('IN');
  });

  it('enforces length bounds and the postal-code character set', () => {
    expect(createAddressSchema.safeParse({ ...VALID, label: '' }).success).toBe(false);
    expect(createAddressSchema.safeParse({ ...VALID, label: 'x'.repeat(61) }).success).toBe(false);
    expect(createAddressSchema.safeParse({ ...VALID, postalCode: '41100$' }).success).toBe(false);
  });

  it('rejects mass-assignment keys (`.strict()`)', () => {
    expect(createAddressSchema.safeParse({ ...VALID, userId: 'someone', id: 'x' }).success).toBe(
      false,
    );
  });
});

describe('updateAddressSchema', () => {
  it('is a partial update that rejects an empty body', () => {
    expect(updateAddressSchema.parse({ city: 'Nagpur' })).toEqual({ city: 'Nagpur' });
    expect(updateAddressSchema.safeParse({}).success).toBe(false);
  });
});

describe('formatAddress', () => {
  const withId = { id: 'addr-1', ...VALID };
  it('joins present parts and skips a null line2', () => {
    expect(formatAddress({ ...withId, line2: null })).toBe(
      '12 MG Road, Pune, Maharashtra, 411001, IN',
    );
    expect(formatAddress(withId)).toContain('Near the park');
  });
});
