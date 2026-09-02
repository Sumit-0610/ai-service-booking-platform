import { z } from 'zod';
import { publicSlotSchema } from './availability.js';

/**
 * Shared contracts for the Claude AI Booking Assistant (Milestone 14).
 *
 * The assistant only ever produces a *draft* structured intent. Every field it
 * returns is re-grounded server-side against real records (active services, the
 * caller's own addresses, a future-dated calendar) before it reaches the
 * client, and nothing here is ever written to the database — booking creation
 * still goes through the normal `POST /api/v1/bookings` flow with its own
 * validation. Claude never sees another user's data and never mutates state.
 */

export const AI_MESSAGE_MAX_LENGTH = 2_000;

export const aiTimeOfDayValues = ['morning', 'afternoon', 'evening'] as const;
export const aiTimeOfDaySchema = z.enum(aiTimeOfDayValues);
export type AiTimeOfDay = (typeof aiTimeOfDayValues)[number];

export const aiIntentFieldValues = ['service', 'date', 'address'] as const;
export const aiIntentFieldSchema = z.enum(aiIntentFieldValues);
export type AiIntentField = (typeof aiIntentFieldValues)[number];

export const aiConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type AiConfidence = z.infer<typeof aiConfidenceSchema>;

/**
 * The structured booking intent. This is both the shape the model is asked to
 * produce (via a forced tool call) and the shape the API returns *after* the
 * backend has validated and grounded every field. Model output that does not
 * match this schema is discarded in favour of a safe clarification fallback.
 */
export const aiBookingIntentSchema = z.object({
  /** A real active service slug, or null. */
  serviceSlug: z.string().min(1).max(200).nullable(),
  /** Other plausible active service slugs (grounded, deduped, capped). */
  serviceCandidateSlugs: z.array(z.string().min(1).max(200)).max(8),
  /** ISO calendar date `YYYY-MM-DD`, today or later, or null. */
  requestedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'requestedDate must be YYYY-MM-DD')
    .nullable(),
  requestedTimeOfDay: aiTimeOfDaySchema.nullable(),
  /** One of the caller's own address ids, or null. */
  addressId: z.string().min(1).max(64).nullable(),
  notes: z.string().max(500).nullable(),
  missingFields: z.array(aiIntentFieldSchema),
  clarificationQuestion: z.string().min(1).max(400).nullable(),
  confidence: aiConfidenceSchema,
});
export type AiBookingIntent = z.infer<typeof aiBookingIntentSchema>;

/** Deterministic, server-authoritative "what is still missing" check. */
export function missingIntentFields(intent: {
  serviceSlug: string | null;
  requestedDate: string | null;
  addressId: string | null;
}): AiIntentField[] {
  const missing: AiIntentField[] = [];
  if (!intent.serviceSlug) missing.push('service');
  if (!intent.requestedDate) missing.push('date');
  if (!intent.addressId) missing.push('address');
  return missing;
}

// --- request bodies (all `.strict()`) ---

export const aiMessageSchema = z.string().trim().min(1).max(AI_MESSAGE_MAX_LENGTH);

export const aiIntentRequestSchema = z.object({ message: aiMessageSchema }).strict();
export type AiIntentRequest = z.infer<typeof aiIntentRequestSchema>;

/**
 * `priorIntent` is treated purely as conversation context — every field in it
 * is re-grounded server-side, so a client cannot smuggle a foreign `addressId`
 * or an unknown `serviceSlug` through it.
 */
export const aiClarifyRequestSchema = z
  .object({ message: aiMessageSchema, priorIntent: aiBookingIntentSchema })
  .strict();
export type AiClarifyRequest = z.infer<typeof aiClarifyRequestSchema>;

export const aiAvailabilityRequestSchema = z
  .object({
    serviceSlug: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Invalid service slug'),
    message: aiMessageSchema.optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export type AiAvailabilityRequest = z.infer<typeof aiAvailabilityRequestSchema>;

// --- response DTOs ---

export const aiMatchedServiceSchema = z.object({
  slug: z.string(),
  name: z.string(),
  priceCents: z.number().int().nonnegative(),
  currency: z.string(),
  durationMinutes: z.number().int().positive(),
});
export type AiMatchedService = z.infer<typeof aiMatchedServiceSchema>;

export const aiIntentResponseSchema = z.object({
  intent: aiBookingIntentSchema,
  matchedService: aiMatchedServiceSchema.nullable(),
  /** A short, human-facing summary line for the chat transcript. */
  assistantMessage: z.string(),
});
export type AiIntentResponse = z.infer<typeof aiIntentResponseSchema>;

export const aiAvailabilityResponseSchema = z.object({
  service: z.object({ slug: z.string(), name: z.string() }),
  answer: z.string(),
  slots: z.array(publicSlotSchema),
  window: z.object({ from: z.string(), to: z.string() }),
});
export type AiAvailabilityResponse = z.infer<typeof aiAvailabilityResponseSchema>;
