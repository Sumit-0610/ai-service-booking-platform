import { randomUUID } from 'node:crypto';
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
 * One `McpServer` + one `StreamableHTTPServerTransport`, every
 * `POST/GET/DELETE /mcp` handled by the SDK. The transport runs in session
 * mode: `initialize` issues an `mcp-session-id` the client echoes on every
 * later request. That is enough for one CLI; multi-client fan-out (a transport
 * per session) and SSE resumability are out of scope.
 *
 * **Single-actor.** Like the stdio entry, the whole process speaks for the one
 * customer named by `AISBP_MCP_ACTOR_EMAIL` and resolved at startup — every
 * HTTP request acts as that customer. Genuine per-request identity (a bearer
 * token resolved to an `Actor` per call) is a later milestone; the `Actor` the
 * tools take does not change.
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
  const mcpServer = buildServer(actor);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  // The SDK's own transport types `onclose` as `(() => void) | undefined`, which
  // `exactOptionalPropertyTypes` rejects against the `Transport` interface's
  // `onclose?: () => void`. The shapes are otherwise identical.
  await mcpServer.connect(transport as Transport);

  const http: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== MCP_PATH) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ error: { code: 'NOT_FOUND', message: `Unknown path ${url.pathname}` } }),
      );
      return;
    }
    void transport.handleRequest(req, res).catch((error: unknown) => {
      logger.error('HTTP request failed', {
        message: error instanceof Error ? error.message : String(error),
      });
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
    async close() {
      await transport.close();
      await mcpServer.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
