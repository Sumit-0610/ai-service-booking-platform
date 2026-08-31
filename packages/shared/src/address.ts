import { z } from 'zod';

/**
 * Shared contracts for customer address management. The API validates request
 * bodies and params against these; the web client validates forms and types
 * responses with them.
 *
 * The address model is deliberately international: no country-specific postal or
 * region rules. `country` is an ISO 3166-1 alpha-2 code; everything else is a
 * trimmed free-text field with a sane length bound.
 */

/** Trim, and turn an empty/whitespace-only optional value into null. */
const optionalLine = z
  .string()
  .trim()
  .max(120)
  .nullish()
  .transform((value) => (value && value.length > 0 ? value : null));

const requiredText = (max: number) => z.string().trim().min(1).max(max);

export const countrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Use a 2-letter country code, e.g. IN');

export const addressFieldSchemas = {
  label: requiredText(60),
  line1: requiredText(120),
  line2: optionalLine,
  city: requiredText(80),
  state: requiredText(80),
  postalCode: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .regex(/^[A-Za-z0-9 -]+$/, 'Postal code may only contain letters, numbers, spaces and hyphens'),
  country: countrySchema,
};

export const createAddressSchema = z.object(addressFieldSchemas).strict();
export type CreateAddressInput = z.infer<typeof createAddressSchema>;

export const updateAddressSchema = z
  .object(addressFieldSchemas)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;

/** Loose enough to accept both cuid and seed-style ids; rejects anything weird. */
export const addressIdParamSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
});

export const addressSchema = z.object({
  id: z.string(),
  label: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
  country: z.string(),
});
export type Address = z.infer<typeof addressSchema>;

export const addressListSchema = z.object({ items: z.array(addressSchema) });
export type AddressList = z.infer<typeof addressListSchema>;

export const addressResponseSchema = z.object({ address: addressSchema });
export type AddressResponse = z.infer<typeof addressResponseSchema>;

export function formatAddress(address: Address): string {
  return [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postalCode,
    address.country,
  ]
    .filter(Boolean)
    .join(', ');
}

/** A small, demo-friendly country list for the address form's dropdown. The
 *  API accepts any well-formed ISO 3166-1 alpha-2 code, not just these. */
export const COMMON_COUNTRIES = [
  { code: 'IN', name: 'India' },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'AU', name: 'Australia' },
  { code: 'CA', name: 'Canada' },
  { code: 'SG', name: 'Singapore' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'NZ', name: 'New Zealand' },
] as const;
