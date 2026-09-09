import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Actor } from './context.js';
import { logger } from './logger.js';
import { buildServer } from './server.js';

/**
 * Streamable HTTP transport for the booking server (Week 2).
 *
 * **Stateless**: every `POST/GET/DELETE /mcp` gets a fresh `McpServer` +
 * `StreamableHTTPServerTransport` (`sessionIdGenerator` absent), both torn down
 * when the response closes. This is the SDK's required shape for stateless mode
 * — reusing one transport across requests causes JSON-RPC id collisions
 * (webStandardStreamableHttp.js:172) — and it removes any "one session at a
 * time" limit: independent requests, safe for multiple clients.
 *
 * `buildServer` is cheap (no DB connection; `repositories` share one Prisma
 * client for the process), so a server-per-request costs almost nothing here.
 *
 * **Single-actor.** Like the stdio entry, the whole process speaks for the one
 * customer named by `AISBP_MCP_ACTOR_EMAIL` and resolved at startup — every
 * HTTP request acts as that customer. Genuine per-request identity (a bearer
 * token resolved to an `Actor` per call) is a later milestone; the `Actor` the
 * tools take does not change. The listener binds loopback by default.
 */

const MCP_PATH = '/mcp';

export interface HttpServerHandle {
  readonly port: number;
  close(): Promise<void>;
}

export async function startHttpServer(
  actor: Actor,
  opts: { port: number; host?: string },
): Promise<HttpServerHandle> {
  const http: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== MCP_PATH) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ error: { code: 'NOT_FOUND', message: `Unknown path ${url.pathname}` } }),
      );
      return;
    }

    const mcpServer = buildServer(actor);
    // Stateless: no `sessionIdGenerator`. The SDK types it as `() => string`
    // (not `| undefined`), which `exactOptionalPropertyTypes` will not let us
    // set to `undefined` explicitly, so we omit it — the constructor reads it
    // as `undefined` and runs stateless.
    const transport = new StreamableHTTPServerTransport({});
    const cleanup = (): void => {
      void transport.close();
      void mcpServer.close();
    };
    res.on('close', cleanup);

    void mcpServer
      // `as Transport`: the SDK's own transport types `onclose` as
      // `(() => void) | undefined`, which `exactOptionalPropertyTypes` rejects
      // against the `Transport` interface's `onclose?: () => void`. Structurally
      // identical; proven by the integration test.
      .connect(transport as Transport)
      .then(() => transport.handleRequest(req, res))
      .catch((error: unknown) => {
        logger.error('HTTP request failed', {
          message: error instanceof Error ? error.message : String(error),
        });
        cleanup();
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'INTERNAL', message: 'Request failed' } }));
        }
      });
  });

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(opts.port, opts.host ?? '127.0.0.1', () => {
      http.off('error', reject);
      resolve();
    });
  });

  const port = (http.address() as AddressInfo).port;
  logger.info('MCP booking server ready', { transport: 'http', port, actor: actor.email });

  return {
    port,
    close() {
      return new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
