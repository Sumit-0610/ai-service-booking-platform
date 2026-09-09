/**
 * Manual smoke check: spin up the server in-process, connect the SDK's own
 * Client over an in-memory transport, list the tools, and call checkAvailability
 * against the real database.
 *
 *   DATABASE_URL=postgresql://... AISBP_MCP_ACTOR_EMAIL=alice@example.com \
 *     pnpm --filter @aisbp/mcp-server smoke -- <serviceType> <YYYY-MM-DD>
 *
 * Defaults to `washing-machine-installation` on the seed's first slot day.
 */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '@aisbp/database';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig, resolveActor } from '../src/context.js';
import { buildServer } from '../src/server.js';

const serviceType = process.argv[2] ?? 'washing-machine-installation';
const date = process.argv[3] ?? '2026-09-10';

async function main(): Promise<void> {
  const config = loadConfig();
  await connectDatabase();
  const actor = await resolveActor(config.actorEmail);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(actor);
  const client = new Client({ name: 'smoke', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const { tools } = await client.listTools();
  console.log('Acting as:', actor.email);
  console.log(
    'Tools:',
    tools.map((t) => t.name),
  );

  const result = await client.callTool({
    name: 'checkAvailability',
    arguments: { serviceType, date },
  });
  console.log('checkAvailability isError:', result.isError ?? false);
  console.log((result.content as { type: string; text: string }[])[0]?.text);

  await Promise.allSettled([client.close(), server.close(), disconnectDatabase()]);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
