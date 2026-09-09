#!/usr/bin/env node
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '@aisbp/database';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, resolveActor } from './context.js';
import { startHttpServer } from './http.js';
import { logger } from './logger.js';
import { buildServer } from './server.js';

/**
 * Entry point: validate configuration, connect to PostgreSQL (via
 * `@aisbp/database`), resolve the acting customer, then serve the booking tools.
 * Standalone — it does not import or start `apps/api`.
 *
 * Transport is chosen by `MCP_TRANSPORT` (`stdio` default, or `http` on
 * `MCP_HTTP_PORT`). Authentication is a later milestone; for now any client that
 * can reach this process calls the tools as the one configured customer.
 *
 * stdout carries the JSON-RPC stream (stdio mode), so all logging goes to stderr.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const mode = process.env.MCP_TRANSPORT ?? 'stdio';

  await connectDatabase();
  const actor = await resolveActor(config.actorEmail);

  if (mode === 'http') {
    const port = Number(process.env.MCP_HTTP_PORT ?? 3333);
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(
        `MCP_HTTP_PORT must be a positive integer, got "${process.env.MCP_HTTP_PORT}"`,
      );
    }
    const handle = await startHttpServer(actor, { port });
    const shutdown = (signal: string): void => {
      logger.info(`Received ${signal}, shutting down`);
      void Promise.allSettled([handle.close(), disconnectDatabase()]).then(() => process.exit(0));
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    return;
  }

  if (mode !== 'stdio') {
    throw new Error(`MCP_TRANSPORT must be "stdio" or "http", got "${mode}"`);
  }

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
