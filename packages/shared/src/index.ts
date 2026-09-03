import { z } from 'zod';

export * from './address.js';
export * from './ai.js';
export * from './auth.js';
export * from './availability.js';
export * from './booking.js';
export * from './catalogue.js';
export * from './operations.js';
export * from './pagination.js';
export * from './pricing.js';
export * from './technician.js';

/**
 * Release metadata for a built image (Milestone 18). Every field is optional —
 * a local/unstamped build omits the whole `version` object. Never carries a
 * secret; the values are a version string, a Git commit SHA, and a build
 * timestamp.
 */
export const appVersionSchema = z.object({
  version: z.string().optional(),
  commit: z.string().optional(),
  buildTime: z.string().optional(),
});

export type AppVersion = z.infer<typeof appVersionSchema>;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  timestamp: z.string().datetime(),
  // Present only when the image was built with release metadata (Milestone 18).
  // Additive and optional, so existing consumers are unaffected.
  version: appVersionSchema.optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
