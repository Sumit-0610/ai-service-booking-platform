import 'dotenv/config';
import { z } from 'zod';

/** Parse "true"/"false"/"1"/"0" env strings into a boolean. */
const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const booleanFromStringWithDefault = (defaultValue: boolean) =>
  booleanFromString.default(defaultValue);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),

  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),

  // Session + cookies
  SESSION_COOKIE_NAME: z.string().min(1).default('aisbp.sid'),
  CSRF_COOKIE_NAME: z.string().min(1).default('aisbp.csrf'),
  SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 7),
  // Defaults to true in production, false otherwise (see below).
  COOKIE_SECURE: booleanFromString.optional(),
  TRUST_PROXY: booleanFromStringWithDefault(false),

  // Brute-force protection
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  REGISTER_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  REGISTER_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(3600),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${z.prettifyError(parsed.error)}`);
}

const isProduction = parsed.data.NODE_ENV === 'production';

export const env = {
  ...parsed.data,
  COOKIE_SECURE: parsed.data.COOKIE_SECURE ?? isProduction,
  isProduction,
  isTest: parsed.data.NODE_ENV === 'test',
};
