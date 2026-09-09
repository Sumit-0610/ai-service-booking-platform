#!/usr/bin/env node
import 'dotenv/config';
import * as readline from 'node:readline/promises';
import { runAgentTurn } from './agent/loop.js';
import { buildSystemPrompt } from './agent/prompt.js';
import { newTranscript, renderStep } from './agent/transcript.js';
import { loadClientConfig } from './config.js';
import { getLlmClient } from './llm/client.js';
import { DEMO_SCRIPT } from './llm/demo-script.js';
import { scriptedLlmClient } from './llm/scripted.js';
import { logger } from './logger.js';
import { createMcpConnection } from './mcp/connect.js';

/**
 * Terminal chat loop: each line you type runs one agent turn against the MCP
 * booking server. The step trace goes to stderr; only the final answers go to
 * stdout (so `... > answers.txt` captures just the replies).
 */
async function main(): Promise<void> {
  const config = loadClientConfig();

  const llm = config.scripted ? scriptedLlmClient(DEMO_SCRIPT) : getLlmClient(config);
  if (!llm) {
    process.stderr.write(
      'No GEMINI_API_KEY set. Get a free key at https://aistudio.google.com/apikey, ' +
        'or run with --scripted for the offline demo.\n',
    );
    process.exit(1);
  }

  const connection = await createMcpConnection({
    mode: config.transport,
    serverUrl: config.serverUrl,
    databaseUrl: config.databaseUrl,
    actorEmail: config.actorEmail,
  });
  logger.info('MCP client ready', {
    transport: config.transport,
    model: config.scripted ? 'scripted' : config.geminiModel,
  });

  const history = newTranscript();
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });

  let closed = false;
  const shutdown = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    rl.close();
    await connection.close();
  };
  process.on('SIGINT', () => {
    void shutdown().then(() => process.exit(0));
  });

  /** Read one line; returns null on EOF (piped input ended, Ctrl-D). */
  const ask = async (): Promise<string | null> => {
    try {
      return await rl.question('\nyou › ');
    } catch {
      return null; // readline closed
    }
  };

  try {
    process.stderr.write('Type a request, or an empty line / "/exit" to quit.\n');
    for (;;) {
      const raw = await ask();
      if (raw === null) break;
      const line = raw.trim();
      if (!line || line === '/exit') break;

      const result = await runAgentTurn({
        llm,
        mcp: connection.client,
        system: buildSystemPrompt(),
        history,
        userMessage: line,
        maxIterations: config.maxIterations,
        onStep: (event) => process.stderr.write(`${renderStep(event)}\n`),
      });
      process.stdout.write(`bot › ${result.answer}\n`);
    }
  } finally {
    await shutdown();
  }
}

main().catch((error: unknown) => {
  logger.error('MCP client failed', {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
