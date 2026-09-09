import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Startup configuration for the CLI. Mirrors `mcp-server/src/context.ts`: a
 * small local Zod schema over `process.env`, then a thin overlay of CLI flags.
 *
 * Transports (`--stdio` default | `--memory` | `--http <url>`) — see
 * `mcp/connect.ts`. `stdio`/`memory` run the booking server themselves, so they
 * need `DATABASE_URL` + `AISBP_MCP_ACTOR_EMAIL`; `http` does not.
 *
 * Conversation persistence (Week 3): `--session <id>` / `--new` store the
 * transcript in Redis and need `REDIS_URL`. Without either, the transcript is
 * in-memory (this run only).
 *
 * Write guardrails (Week 3): each `createBooking` / `cancelOrReschedule` is
 * confirmed y/n in interactive mode (skip with `--yes`), and a per-conversation
 * write cap (`MCP_MAX_WRITES_PER_SESSION`) always applies.
 */

const envSchema = z.object({
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).default('gemini-flash-latest'),
  MCP_TRANSPORT: z.enum(['stdio', 'memory', 'http']).default('stdio'),
  MCP_SERVER_URL: z.string().url().optional(),
  MCP_HTTP_PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_URL: z.string().min(1).optional(),
  AISBP_MCP_ACTOR_EMAIL: z
    .string()
    .min(1)
    .transform((value) => value.trim().toLowerCase())
    .optional(),
  MCP_AGENT_MAX_ITERATIONS: z.coerce.number().int().positive().max(50).default(8),
  MCP_LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  REDIS_URL: z.string().url().optional(),
  MCP_SESSION_ID: z.string().min(1).max(200).optional(),
  MCP_CONVERSATION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24),
  MCP_MAX_WRITES_PER_SESSION: z.coerce.number().int().positive().max(100).default(3),
});

export type McpTransportMode = 'stdio' | 'memory' | 'http';

export interface ClientConfig {
  geminiApiKey: string | undefined;
  geminiModel: string;
  transport: McpTransportMode;
  serverUrl: string | undefined;
  httpPort: number;
  databaseUrl: string | undefined;
  actorEmail: string | undefined;
  maxIterations: number;
  llmTimeoutMs: number;
  /** `--scripted`: deterministic in-process fake LLM (no key, no network). */
  scripted: boolean;
  redisUrl: string | undefined;
  /** Set when the transcript should be persisted; undefined = in-memory only. */
  sessionId: string | undefined;
  conversationTtlSeconds: number;
  maxWritesPerSession: number;
  /** `--yes`: skip the interactive write confirmation (cap still applies). */
  autoApproveWrites: boolean;
}

interface Flags {
  transport?: McpTransportMode | undefined;
  serverUrl?: string | undefined;
  maxIterations?: number | undefined;
  model?: string | undefined;
  scripted: boolean;
  sessionId?: string | undefined;
  newSession: boolean;
  autoApproveWrites: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { scripted: false, newSession: false, autoApproveWrites: false };
  const args = argv.slice(2);

  const value = (index: number, flag: string): string => {
    const next = args[index];
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`${flag} needs a value`);
    }
    return next;
  };

  for (let i = 0; i < args.length; i += 1) {
    switch (args[i]) {
      case '--stdio':
        flags.transport = 'stdio';
        break;
      case '--memory':
        flags.transport = 'memory';
        break;
      case '--http':
        flags.transport = 'http';
        flags.serverUrl = value((i += 1), '--http');
        break;
      case '--scripted':
        flags.scripted = true;
        break;
      case '--model':
        flags.model = value((i += 1), '--model');
        break;
      case '--max-iterations':
        flags.maxIterations = Number(value((i += 1), '--max-iterations'));
        break;
      case '--session':
        flags.sessionId = value((i += 1), '--session');
        break;
      case '--new':
        flags.newSession = true;
        break;
      case '--yes':
        flags.autoApproveWrites = true;
        break;
      default:
        // Unknown args are ignored so `pnpm ... -- <flag>` passthrough is safe.
        break;
    }
  }
  return flags;
}

export function loadClientConfig(
  argv: string[] = process.argv,
  source: NodeJS.ProcessEnv = process.env,
): ClientConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid MCP client configuration: ${z.prettifyError(parsed.error)}`);
  }
  const env = parsed.data;
  const flags = parseFlags(argv);

  const transport = flags.transport ?? env.MCP_TRANSPORT;
  const serverUrl = flags.serverUrl ?? env.MCP_SERVER_URL;
  const maxIterations = flags.maxIterations ?? env.MCP_AGENT_MAX_ITERATIONS;

  if (Number.isNaN(maxIterations) || maxIterations <= 0) {
    throw new Error('--max-iterations must be a positive integer');
  }
  if (transport === 'http' && !serverUrl) {
    throw new Error('http transport needs a server URL: --http <url> or MCP_SERVER_URL');
  }
  if (transport !== 'http' && (!env.DATABASE_URL || !env.AISBP_MCP_ACTOR_EMAIL)) {
    throw new Error(
      `${transport} transport runs the booking server itself; set DATABASE_URL and AISBP_MCP_ACTOR_EMAIL`,
    );
  }

  const wantsPersistence =
    flags.newSession || flags.sessionId !== undefined || !!env.MCP_SESSION_ID;
  if (wantsPersistence && !env.REDIS_URL) {
    throw new Error('conversation persistence (--session / --new) needs REDIS_URL');
  }
  const sessionId = wantsPersistence
    ? (flags.sessionId ?? env.MCP_SESSION_ID ?? randomUUID())
    : undefined;

  return {
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: flags.model ?? env.GEMINI_MODEL,
    transport,
    serverUrl,
    httpPort: env.MCP_HTTP_PORT,
    databaseUrl: env.DATABASE_URL,
    actorEmail: env.AISBP_MCP_ACTOR_EMAIL,
    maxIterations,
    llmTimeoutMs: env.MCP_LLM_TIMEOUT_MS,
    scripted: flags.scripted,
    redisUrl: env.REDIS_URL,
    sessionId,
    conversationTtlSeconds: env.MCP_CONVERSATION_TTL_SECONDS,
    maxWritesPerSession: env.MCP_MAX_WRITES_PER_SESSION,
    autoApproveWrites: flags.autoApproveWrites,
  };
}
