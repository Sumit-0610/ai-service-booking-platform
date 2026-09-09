import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { connectDatabase, disconnectDatabase } from '@aisbp/database';
import { resolveActor } from '@aisbp/mcp-server/context';
import { buildServer } from '@aisbp/mcp-server/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpTransportMode } from '../config.js';

/**
 * Opens an MCP `Client` connected to the booking server over one of three
 * transports. Returns the client plus a `close()` that tears down everything
 * this function created (and only that).
 *
 *  - `memory`: booking server runs in-process (the `smoke.ts` pattern). Fast,
 *    no build, no child process. This owns a Prisma connection.
 *  - `stdio`: spawns the built `mcp-server` (`dist/index.js`) as a child.
 *    Requires `pnpm --filter @aisbp/mcp-server build` first.
 *  - `http`: connects to a running server's Streamable HTTP endpoint. No DB or
 *    actor here — the server owns identity.
 */

export interface McpConnectionOptions {
  mode: McpTransportMode;
  serverUrl?: string | undefined;
  databaseUrl?: string | undefined;
  actorEmail?: string | undefined;
}

export interface McpConnection {
  client: Client;
  close(): Promise<void>;
}

const CLIENT_INFO = { name: 'aisbp-mcp-client', version: '0.1.0' } as const;

export async function createMcpConnection(opts: McpConnectionOptions): Promise<McpConnection> {
  switch (opts.mode) {
    case 'memory':
      return connectInMemory(opts);
    case 'stdio':
      return connectStdio(opts);
    case 'http':
      return connectHttp(opts);
  }
}

async function connectInMemory(opts: McpConnectionOptions): Promise<McpConnection> {
  if (!opts.actorEmail) {
    throw new Error('memory transport needs actorEmail');
  }
  await connectDatabase();
  const actor = await resolveActor(opts.actorEmail);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(actor);
  const client = new Client(CLIENT_INFO);
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    async close() {
      await Promise.allSettled([client.close(), server.close(), disconnectDatabase()]);
    },
  };
}

async function connectStdio(opts: McpConnectionOptions): Promise<McpConnection> {
  if (!opts.databaseUrl || !opts.actorEmail) {
    throw new Error('stdio transport needs databaseUrl and actorEmail for the child server');
  }
  const serverEntry = resolveServerDistEntry();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: {
      ...getDefaultEnvironment(),
      DATABASE_URL: opts.databaseUrl,
      AISBP_MCP_ACTOR_EMAIL: opts.actorEmail,
      MCP_TRANSPORT: 'stdio',
    },
    stderr: 'inherit',
  });
  const client = new Client(CLIENT_INFO);
  await client.connect(transport);

  return {
    client,
    async close() {
      await client.close(); // also terminates the child
    },
  };
}

async function connectHttp(opts: McpConnectionOptions): Promise<McpConnection> {
  if (!opts.serverUrl) {
    throw new Error('http transport needs serverUrl');
  }
  const transport = new StreamableHTTPClientTransport(new URL(opts.serverUrl));
  const client = new Client(CLIENT_INFO);
  // `as Transport`: the SDK types this transport's `sessionId` as `string |
  // undefined`, which `exactOptionalPropertyTypes` rejects against `Transport`.
  await client.connect(transport as Transport);

  return {
    client,
    async close() {
      await client.close();
    },
  };
}

/** `<mcp-server package dir>/dist/index.js` — the built stdio entry. */
function resolveServerDistEntry(): string {
  const pkgJson = fileURLToPath(import.meta.resolve('@aisbp/mcp-server/package.json'));
  return path.join(path.dirname(pkgJson), 'dist', 'index.js');
}
