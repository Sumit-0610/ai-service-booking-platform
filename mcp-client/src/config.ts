import { z } from 'zod';

/**
 * Startup configuration for the CLI. Mirrors `mcp-server/src/context.ts`: a
 * small local Zod schema over `process.env`, then a thin overlay of CLI flags.
 *
 * The CLI talks to the booking server over one of three transports:
 *  - `stdio` (default): spawns the built `mcp-server` as a child process,
 *  - `memory`: runs the booking server in-process (fast; used by tests),
 *  - `http`: connects to an already-running server's Streamable HTTP endpoint.
 *
 * `memory` and `stdio` run the booking server themselves, so they need
 * `DATABASE_URL` + `AISBP_MCP_ACTOR_EMAIL`. `http` does not — the server owns
 * identity.
 */

const envSchema = z.object({
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).default('gemini-2.0-flash'),
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
  /** `--scripted`: use the deterministic in-process fake LLM (no key, no network). */
  scripted: boolean;
}

interface Flags {
  transport?: McpTransportMode | undefined;
  serverUrl?: string | undefined;
  maxIterations?: number | undefined;
  model?: string | undefined;
  scripted: boolean;
}

/** Parse the handful of flags the CLI accepts. */
function parseFlags(argv: string[]): Flags {
  const flags: Flags = { scripted: false };
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

  return {
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: flags.model ?? env.GEMINI_MODEL,
    transport,
    serverUrl,
    httpPort: env.MCP_HTTP_PORT,
    databaseUrl: env.DATABASE_URL,
    actorEmail: env.AISBP_MCP_ACTOR_EMAIL,
    maxIterations,
    scripted: flags.scripted,
  };
}
