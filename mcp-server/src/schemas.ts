import { z } from 'zod';

/**
 * Input contracts for the four booking tools.
 *
 * Each tool has two schemas:
 *
 *  - `*Shape` — the raw shape advertised to MCP clients and parsed by the SDK
 *    before the handler runs. Deliberately permissive (types + descriptions
 *    only): the SDK rejects invalid input with its own plain-text
 *    `-32602` message, so keeping the strict rules *out* of this layer means
 *    **every** rejection — malformed and cross-field alike — comes back through
 *    one path (`*Schema` below) in the standard
 *    `{ error: { code, message, details } }` envelope.
 *  - `*Schema` — the real validation (id format, date format, enums,
 *    cross-field rules). Re-parsed at the top of every handler; a `ZodError`
 *    here becomes a `VALIDATION_ERROR` result before any database call.
 *
 * Id shape matches the REST API's `bookingIdParamSchema` / `resourceIdParamSchema`:
 * a cuid or a seed-style id, 8–64 chars of `[A-Za-z0-9-]`.
 */

const idString = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9-]{8,64}$/,
    'Must be a valid resource id (8–64 chars: letters, digits, hyphen)',
  );

const serviceTypeString = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe(
    'A service slug ("washing-machine-installation") or its display name ("Washing machine installation").',
  );

/** A calendar date with no time or zone: `YYYY-MM-DD`, interpreted as UTC. */
const calendarDateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a calendar date in YYYY-MM-DD format')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, 'Must be a real calendar date');

// ---------------------------------------------------------------------------
// checkAvailability
// ---------------------------------------------------------------------------

export const checkAvailabilityShape = {
  serviceType: serviceTypeString,
  date: z.string().describe('The day to check, YYYY-MM-DD (UTC).'),
  location: z
    .string()
    .optional()
    .describe(
      "Optional. Free-text service area to narrow results, matched (case-insensitive substring) against each technician's coverage area.",
    ),
} as const;
export const checkAvailabilitySchema = z
  .object({
    serviceType: serviceTypeString,
    date: calendarDateString,
    location: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type CheckAvailabilityInput = z.infer<typeof checkAvailabilitySchema>;

// ---------------------------------------------------------------------------
// createBooking
// ---------------------------------------------------------------------------

export const createBookingShape = {
  serviceType: serviceTypeString,
  slot: z
    .string()
    .describe('The availability slot id to book — the `slotId` returned by checkAvailability.'),
  addressId: z
    .string()
    .optional()
    .describe(
      "Optional. Which of the customer's addresses to service. Omit when the customer has exactly one address on file; required (with the id from getBookingDetails / an address list) when they have several.",
    ),
} as const;
export const createBookingSchema = z
  .object({
    serviceType: serviceTypeString,
    slot: idString,
    addressId: idString.optional(),
  })
  .strict();
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

// ---------------------------------------------------------------------------
// getBookingDetails
// ---------------------------------------------------------------------------

export const getBookingDetailsShape = {
  bookingId: z.string().describe('The booking id to fetch.'),
} as const;
export const getBookingDetailsSchema = z.object({ bookingId: idString }).strict();
export type GetBookingDetailsInput = z.infer<typeof getBookingDetailsSchema>;

// ---------------------------------------------------------------------------
// cancelOrReschedule
// ---------------------------------------------------------------------------

export const cancelOrRescheduleShape = {
  bookingId: z.string().describe('The booking id to change.'),
  action: z
    .string()
    .describe(
      'One of "cancel" (end the booking) or "reschedule" (move it to a different slot — requires newSlot).',
    ),
  newSlot: z
    .string()
    .optional()
    .describe('Required when action is "reschedule": the new availability slot id (same service).'),
} as const;
export const cancelOrRescheduleSchema = z
  .object({
    bookingId: idString,
    action: z.enum(['cancel', 'reschedule']),
    newSlot: idString.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === 'reschedule' && !value.newSlot) {
      ctx.addIssue({
        code: 'custom',
        path: ['newSlot'],
        message: 'newSlot is required when action is "reschedule"',
      });
    }
    if (value.action === 'cancel' && value.newSlot) {
      ctx.addIssue({
        code: 'custom',
        path: ['newSlot'],
        message: 'newSlot must be omitted when action is "cancel"',
      });
    }
  });
export type CancelOrRescheduleInput = z.infer<typeof cancelOrRescheduleSchema>;
