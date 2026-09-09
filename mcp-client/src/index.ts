#!/usr/bin/env node
import 'dotenv/config';
import * as readline from 'node:readline/promises';
import { Guardrails, type ConfirmFn } from './agent/guardrails.js';
import { runAgentTurn } from './agent/loop.js';
import { buildSystemPrompt } from './agent/prompt.js';
import { newTranscript, renderStep } from './agent/transcript.js';
import { loadClientConfig } from './config.js';
import {
  ConversationActorMismatchError,
  InMemoryConversationStore,
  RedisConversationStore,
  type ConversationStore,
} from './conversation/store.js';
import { getLlmClient } from './llm/client.js';
import { DEMO_SCRIPT } from './llm/demo-script.js';
import { scriptedLlmClient } from './llm/scripted.js';
import { logger } from './logger.js';
import { createMcpConnection } from './mcp/connect.js';

/**
 * Terminal chat loop. Each line runs one agent turn against the MCP booking
 * server. Step trace → stderr; final answers → stdout. Write tool calls
 * (`createBooking` / `cancelOrReschedule`) are confirmed before they run; the
 * transcript is persisted to Redis when a session id is configured.
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

  const store: ConversationStore =
    config.sessionId && config.redisUrl
      ? RedisConversationStore.fromUrl(
          config.redisUrl,
          config.actorEmail ?? 'http-actor',
          config.conversationTtlSeconds,
        )
      : new InMemoryConversationStore();
  const sessionKey = config.sessionId ?? 'local';

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });

  // Capture input lines from the moment the interface exists — piped stdin can
  // reach EOF during the async setup below, and a line that arrived before we
  // asked for it must not be lost.
  const pending: string[] = [];
  const waiters: Array<(value: string | null) => void> = [];
  let inputEnded = false;
  rl.on('line', (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else pending.push(line);
  });
  rl.on('close', () => {
    inputEnded = true;
    while (waiters.length) waiters.shift()?.(null);
  });
  const readLine = (promptText: string): Promise<string | null> => {
    if (pending.length) return Promise.resolve(pending.shift() ?? null);
    if (inputEnded) return Promise.resolve(null);
    process.stderr.write(promptText);
    return new Promise((resolve) => waiters.push(resolve));
  };

  let closed = false;
  const shutdown = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    rl.close();
    await Promise.allSettled([connection.close(), store.close()]);
  };
  process.on('SIGINT', () => {
    void shutdown().then(() => process.exit(0));
  });

  // Write-tool confirmation policy: prompt on a TTY; `--yes` / `--scripted`
  // auto-allow (the per-session cap still applies); a non-TTY run with neither
  // fails the write safe rather than acting unattended.
  const interactive = process.stdin.isTTY === true;
  const confirm: ConfirmFn | undefined =
    config.scripted || config.autoApproveWrites
      ? undefined
      : async (call) => {
          if (!interactive) return false;
          const answer = (
            (await readLine(`\n  confirm ${call.name}(${JSON.stringify(call.args)}) — y/N › `)) ??
            ''
          )
            .trim()
            .toLowerCase();
          return answer === 'y' || answer === 'yes';
        };
  const newGuardrails = (): Guardrails =>
    new Guardrails({ maxWrites: config.maxWritesPerSession, confirm });

  let history = newTranscript();
  try {
    const loaded = await store.load(sessionKey);
    history = loaded.messages;
    if (config.sessionId) {
      process.stderr.write(
        loaded.resumed
          ? `resumed session ${config.sessionId} (${history.length} messages)\n`
          : `session ${config.sessionId} — resume later with --session ${config.sessionId}\n`,
      );
    }
  } catch (error) {
    if (error instanceof ConversationActorMismatchError) {
      process.stderr.write(`${error.message}\n`);
      await shutdown();
      process.exit(1);
    }
    throw error;
  }

  let guardrails = newGuardrails();
  logger.info('MCP client ready', {
    transport: config.transport,
    model: config.scripted ? 'scripted' : config.geminiModel,
    persistent: store.persistent,
    confirmWrites: confirm !== undefined,
  });

  const ask = (): Promise<string | null> => readLine('\nyou › ');

  try {
    process.stderr.write(
      'Type a request, an empty line / "/exit" to quit, or "/clear" to reset.\n',
    );
    for (;;) {
      const raw = await ask();
      if (raw === null) break;
      const line = raw.trim();
      if (!line || line === '/exit') break;
      if (line === '/clear') {
        history = newTranscript();
        guardrails = newGuardrails();
        await store.clear(sessionKey);
        process.stderr.write('(conversation cleared)\n');
        continue;
      }

      try {
        const result = await runAgentTurn({
          llm,
          mcp: connection.client,
          system: buildSystemPrompt(),
          history,
          userMessage: line,
          maxIterations: config.maxIterations,
          guardrails,
          onStep: (event) => process.stderr.write(`${renderStep(event)}\n`),
        });
        await store.save(sessionKey, history);
        process.stdout.write(`bot › ${result.answer}\n`);
      } catch (error) {
        // An LLM/transport failure ends the turn, not the session — the
        // (persisted) transcript keeps whatever the turn managed to do.
        await store.save(sessionKey, history);
        const message = error instanceof Error ? error.message : String(error);
        process.stdout.write(`bot › (couldn't complete that turn: ${message.slice(0, 300)})\n`);
      }
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
