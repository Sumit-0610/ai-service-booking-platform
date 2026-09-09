import { repositories } from '@aisbp/database';
import { z } from 'zod';

/**
 * Startup configuration and the authenticated actor.
 *
 * A stdio MCP server is spawned by exactly one client, configured by one
 * operator, and speaks for one identity for the life of the process — the same
 * model the GitHub / filesystem MCP servers use. That identity is supplied as
 * `AISBP_MCP_ACTOR_EMAIL` and resolved against the real `User` table at
 * startup; the process refuses to start if it is missing, unknown, or not a
 * customer account. Every booking tool then operates as that customer and
 * cannot reach another customer's rows.
 *
 * When a later milestone adds an HTTP transport, per-request tokens replace
 * this single env identity; the `Actor` shape the tools depend on stays the
 * same.
 */

const configSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (the platform PostgreSQL).'),
  AISBP_MCP_ACTOR_EMAIL: z
    .string()
    .min(1, 'AISBP_MCP_ACTOR_EMAIL is required — the email of the customer this server acts as.')
    .transform((value) => value.trim().toLowerCase()),
});

export interface McpConfig {
  databaseUrl: string;
  actorEmail: string;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): McpConfig {
  const parsed = configSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid MCP server configuration: ${z.prettifyError(parsed.error)}`);
  }
  return { databaseUrl: parsed.data.DATABASE_URL, actorEmail: parsed.data.AISBP_MCP_ACTOR_EMAIL };
}

export interface Actor {
  id: string;
  email: string;
  name: string;
}

/** Resolve the configured actor email to a real customer, or throw. */
export async function resolveActor(email: string): Promise<Actor> {
  const user = await repositories.users.findByEmail(email);
  if (!user) {
    throw new Error(`AISBP_MCP_ACTOR_EMAIL="${email}" does not match any account.`);
  }
  if (user.role !== 'customer') {
    throw new Error(
      `AISBP_MCP_ACTOR_EMAIL="${email}" is a "${user.role}" account; this server only acts for customers.`,
    );
  }
  return { id: user.id, email: user.email, name: user.name };
}
