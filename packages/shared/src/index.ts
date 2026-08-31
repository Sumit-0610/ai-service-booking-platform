import { z } from 'zod';

export * from './address.js';
export * from './auth.js';
export * from './catalogue.js';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
