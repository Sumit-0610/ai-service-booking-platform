import 'dotenv/config';
import { z } from 'zod';

/** Parse "true"/"false"/"1"/"0" env strings into a boolean. */
const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const booleanFromStringWithDefault = (defaultValue: boolean) =>
  booleanFromString.default(defaultValue);

/**
 * An optional string env var where an empty string is treated as absent. Container
 * runtimes (Docker Compose's `${VAR:-}`, Kubernetes, …) commonly forward an unset
 * variable as `""`; without this a `.min(1)` check would reject it as invalid.
 */
const optionalEnvString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  // An empty string (a container "unset" value) collapses to the dev default so
  // schema parsing still succeeds; the production presence check below then
  // rejects it with a clear message rather than a generic "Invalid URL".
  WEB_ORIGIN: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.url().default('http://localhost:5173'),
  ),

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

  // Redis read-through cache (Milestone 13). The cache is a pure optimisation
  // over PostgreSQL — disabling it or losing Redis only costs a cache miss.
  CACHE_ENABLED: booleanFromStringWithDefault(true),
  // TTL for the public catalogue cache (categories + services). Short by design:
  // catalogue rows only change via a migration/seed today, so a stale window of
  // a couple of minutes is the whole invalidation strategy.
  CATALOGUE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(120),

  // Claude AI Booking Assistant (Milestone 14). The key is server-side only and
  // optional — with no key (or AI_ASSISTANT_ENABLED=false) the assistant
  // endpoints return a safe 503 and the rest of the API is unaffected.
  ANTHROPIC_API_KEY: optionalEnvString,
  ANTHROPIC_MODEL: z.string().min(1).default('claude-sonnet-5'),
  AI_ASSISTANT_ENABLED: booleanFromStringWithDefault(true),
  // Deterministic in-process Claude stub for E2E tests — no network call, no key.
  // Ignored in production (guarded in `getClaudeClient`). Never a security bypass:
  // the AI endpoints re-ground every field server-side regardless of the source.
  AI_ASSISTANT_STUB: booleanFromStringWithDefault(false),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  AI_MAX_MESSAGE_CHARS: z.coerce.number().int().positive().default(2_000),
  AI_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  AI_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(3600),

  // Deployment / release metadata (Milestone 18). Baked into the image at build
  // time (Docker build args → env) so a running container can report exactly
  // which commit it is. All optional — absent in local dev, present in a
  // published image. Never secret.
  APP_VERSION: optionalEnvString,
  APP_COMMIT: optionalEnvString,
  APP_BUILD_TIME: optionalEnvString,
});

export interface AppVersionMetadata {
  version: string | undefined;
  commit: string | undefined;
  buildTime: string | undefined;
}

export interface LoadedEnv {
  env: Omit<z.infer<typeof envSchema>, 'COOKIE_SECURE'> & {
    COOKIE_SECURE: boolean;
    isProduction: boolean;
    isTest: boolean;
  };
  appVersion: AppVersionMetadata;
  hasAppVersion: boolean;
}

/**
 * Parse and validate configuration from an env source. Exported (rather than
 * only run at module load) so the production guards can be tested directly with
 * a fabricated environment.
 */
export function loadEnv(source: NodeJS.ProcessEnv): LoadedEnv {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${z.prettifyError(parsed.error)}`);
  }

  const isProduction = parsed.data.NODE_ENV === 'production';

  // Milestone 18 — production configuration must be explicit, never the local
  // development fallback. `WEB_ORIGIN` scopes CORS and the session cookie to the
  // browser-facing origin; silently defaulting it to `http://localhost:5173` in
  // production would break auth against the real origin. `DATABASE_URL` /
  // `REDIS_URL` already fail fast (no default). We enforce presence here; the
  // scheme (HTTPS in a real deployment) is a documented operator responsibility,
  // not enforced in code, so the local plain-HTTP integration stack still runs.
  if (isProduction && !source.WEB_ORIGIN) {
    throw new Error(
      'Invalid environment configuration: WEB_ORIGIN must be set explicitly when NODE_ENV=production ' +
        '(the browser-facing origin of the web app, e.g. https://app.example.com).',
    );
  }

  const appVersion: AppVersionMetadata = {
    version: parsed.data.APP_VERSION,
    commit: parsed.data.APP_COMMIT,
    buildTime: parsed.data.APP_BUILD_TIME,
  };

  return {
    env: {
      ...parsed.data,
      COOKIE_SECURE: parsed.data.COOKIE_SECURE ?? isProduction,
      isProduction,
      isTest: parsed.data.NODE_ENV === 'test',
    },
    appVersion,
    hasAppVersion:
      appVersion.version !== undefined ||
      appVersion.commit !== undefined ||
      appVersion.buildTime !== undefined,
  };
}

const loaded = loadEnv(process.env);

export const env = loaded.env;

/**
 * Release metadata for the running image (Milestone 18). `undefined` fields mean
 * the value was not baked in (local dev / an unstamped build).
 */
export const appVersion = loaded.appVersion;

/** True when at least one release-metadata field is present. */
export const hasAppVersion = loaded.hasAppVersion;
