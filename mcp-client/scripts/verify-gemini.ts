/**
 * One real end-to-end turn against the live Gemini API — the check that a
 * scripted test cannot do. Needs `GEMINI_API_KEY`, `DATABASE_URL`, and
 * `AISBP_MCP_ACTOR_EMAIL` (a seeded customer). Runs in-process (memory
 * transport), sends one booking request, and asserts the model actually called
 * `checkAvailability` against the real DB. Exits non-zero on any failure.
 *
 *   GEMINI_API_KEY=... DATABASE_URL=... AISBP_MCP_ACTOR_EMAIL=alice@example.com \
 *     pnpm --filter @aisbp/mcp-client verify:gemini
 */
import 'dotenv/config';
import { runAgentTurn } from '../src/agent/loop.js';
import { buildSystemPrompt } from '../src/agent/prompt.js';
import { newTranscript, renderStep } from '../src/agent/transcript.js';
import { loadClientConfig } from '../src/config.js';
import { getLlmClient } from '../src/llm/client.js';
import { createMcpConnection } from '../src/mcp/connect.js';

const PROMPT =
  process.argv[2] ??
  'What washing machine installation appointments are open in the next two weeks?';

async function main(): Promise<void> {
  const config = loadClientConfig(['node', 'verify', '--memory']);
  const llm = getLlmClient(config);
  if (!llm) {
    console.error('FAIL: GEMINI_API_KEY is not set.');
    process.exit(2);
  }

  const connection = await createMcpConnection({
    mode: 'memory',
    databaseUrl: config.databaseUrl,
    actorEmail: config.actorEmail,
  });

  try {
    const calledTools: string[] = [];
    const history = newTranscript();
    const result = await runAgentTurn({
      llm,
      mcp: connection.client,
      system: buildSystemPrompt(),
      history,
      userMessage: PROMPT,
      maxIterations: config.maxIterations,
      onStep: (event) => {
        if (event.type === 'tool_call') calledTools.push(event.name);
        process.stderr.write(`${renderStep(event)}\n`);
      },
    });

    console.error(`\nmodel (${config.geminiModel}): ${result.answer}`);
    console.error(`tools called: ${calledTools.join(', ') || '(none)'}`);

    if (!calledTools.includes('checkAvailability')) {
      console.error('\nFAIL: the model did not call checkAvailability.');
      process.exit(1);
    }
    console.error('\nPASS: real Gemini call → real MCP tool → real DB.');
  } finally {
    await connection.close();
  }
}

main().catch((error: unknown) => {
  console.error('FAIL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
