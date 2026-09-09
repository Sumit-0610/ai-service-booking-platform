#!/usr/bin/env node
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '@aisbp/database';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, resolveActor } from './context.js';
import { logger } from './logger.js';
import { buildServer } from './server.js';

/**
 * Entry point: validate configuration, connect to PostgreSQL (via
 * `@aisbp/database`), resolve the acting customer, then serve the booking tools
 * over stdio. Standalone — it does not import or start `apps/api`.
 *
 * stdout carries the JSON-RPC stream, so all logging goes to stderr.
 */
async function main(): Promise<void> {
  const config = loadConfig();

  await connectDatabase();
  const actor = await resolveActor(config.actorEmail);

  const server = buildServer(actor);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('MCP booking server ready', { transport: 'stdio', actor: actor.email });

  const shutdown = (signal: string): void => {
    logger.info(`Received ${signal}, shutting down`);
    void Promise.allSettled([server.close(), disconnectDatabase()]).then(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  logger.error('Failed to start MCP booking server', {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
