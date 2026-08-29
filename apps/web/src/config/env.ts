import { z } from 'zod';

const clientEnvSchema = z.object({
  VITE_API_BASE_URL: z.string().url().default('http://localhost:4000'),
});

export const clientEnv = clientEnvSchema.parse(import.meta.env);
