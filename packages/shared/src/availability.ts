import { z } from 'zod';

/**
 * Shared contracts for availability and scheduling.
 *
 * Time model: every instant on the wire is an ISO 8601 string. On input it MUST
 * carry a timezone designator (`Z` or `±HH:MM`); a bare wall-clock string is
 * rejected. Responses are always UTC with millisecond precision
 * (`2026-09-15T09:00:00.000Z`). All business logic runs in UTC; the frontend
 * renders instants in the viewer's local timezone.
 */

export const AVAILABILITY_DEFAULT_WINDOW_DAYS = 14;
export const AVAILABILITY_MAX_WINDOW_DAYS = 62;
export const SLOT_MAX_HOURS = 12;
export const SLOT_MAX_ADVANCE_DAYS = 365;

const MS_PER_MINUTE = 60_000;

/** ISO 8601 instant with an explicit offset, parsed to a `Date`. */
export const isoInstant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

export const resourceIdParamSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
});

// ---------------------------------------------------------------------------
// Public availability (customer)
// ---------------------------------------------------------------------------

export const availabilityWindowQuerySchema = z.object({
  from: isoInstant.optional(),
  to: isoInstant.optional(),
});
export type AvailabilityWindowQuery = z.infer<typeof availabilityWindowQuerySchema>;

export const publicSlotSchema = z.object({
  id: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  durationMinutes: z.number().int().positive(),
});
export type PublicSlot = z.infer<typeof publicSlotSchema>;

export const publicAvailabilitySchema = z.object({
  items: z.array(publicSlotSchema),
  window: z.object({ from: z.string(), to: z.string() }),
});
export type PublicAvailability = z.infer<typeof publicAvailabilitySchema>;

// ---------------------------------------------------------------------------
// Technician availability management
// ---------------------------------------------------------------------------

export const availabilitySlotStatusSchema = z.enum(['available', 'held', 'booked', 'unavailable']);
export type AvailabilitySlotStatus = z.infer<typeof availabilitySlotStatusSchema>;

export const technicianSlotSchema = z.object({
  id: z.string(),
  service: z.object({ slug: z.string(), name: z.string() }),
  startsAt: z.string(),
  endsAt: z.string(),
  durationMinutes: z.number().int().positive(),
  status: availabilitySlotStatusSchema,
  booked: z.boolean(),
});
export type TechnicianSlot = z.infer<typeof technicianSlotSchema>;

export const technicianSlotListSchema = z.object({ items: z.array(technicianSlotSchema) });
export type TechnicianSlotList = z.infer<typeof technicianSlotListSchema>;

/**
 * Business rules for a slot's time window. Returns `null` when valid, otherwise
 * the offending field and a user-safe message. Used by the create schema and by
 * the update service (which re-checks the merged window).
 */
export function checkSlotTimes(
  startsAt: Date,
  endsAt: Date,
  now: number = Date.now(),
): { field: 'startsAt' | 'endsAt'; message: string } | null {
  if (endsAt.getTime() <= startsAt.getTime()) {
    return { field: 'endsAt', message: 'The end time must be after the start time' };
  }
  if (endsAt.getTime() - startsAt.getTime() > SLOT_MAX_HOURS * 3_600_000) {
    return { field: 'endsAt', message: `A slot cannot be longer than ${SLOT_MAX_HOURS} hours` };
  }
  if (startsAt.getTime() <= now) {
    return { field: 'startsAt', message: 'The start time must be in the future' };
  }
  if (startsAt.getTime() >= now + SLOT_MAX_ADVANCE_DAYS * 86_400_000) {
    return {
      field: 'startsAt',
      message: `Availability can be created at most ${SLOT_MAX_ADVANCE_DAYS} days ahead`,
    };
  }
  return null;
}

export const createSlotSchema = z
  .object({
    serviceSlug: z.string().trim().min(1).max(200),
    startsAt: isoInstant,
    endsAt: isoInstant,
  })
  .strict()
  .superRefine((value, ctx) => {
    const problem = checkSlotTimes(value.startsAt, value.endsAt);
    if (problem) {
      ctx.addIssue({ code: 'custom', path: [problem.field], message: problem.message });
    }
  });
export type CreateSlotInput = z.infer<typeof createSlotSchema>;

export const updateSlotSchema = z
  .object({
    serviceSlug: z.string().trim().min(1).max(200),
    startsAt: isoInstant,
    endsAt: isoInstant,
  })
  .strict()
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });
export type UpdateSlotInput = z.infer<typeof updateSlotSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function durationMinutes(startsAt: Date | string, endsAt: Date | string): number {
  const start = typeof startsAt === 'string' ? Date.parse(startsAt) : startsAt.getTime();
  const end = typeof endsAt === 'string' ? Date.parse(endsAt) : endsAt.getTime();
  return Math.round((end - start) / MS_PER_MINUTE);
}
