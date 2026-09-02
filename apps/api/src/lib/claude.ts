import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * The Claude API boundary (Milestone 14).
 *
 * The AI service depends on the `ClaudeClient` interface, never on the SDK
 * directly, so the integration tests inject a scripted fake and CI never makes a
 * real API call. `getClaudeClient()` returns `null` when the assistant is
 * disabled or unconfigured — callers turn that into a safe `503`.
 *
 * Observability: every call logs safe metadata only (operation, model, latency,
 * token counts, outcome). Prompts and completions are never logged.
 */

export type AiOperation = 'intent' | 'clarify' | 'availability';

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredRequest {
  operation: AiOperation;
  system: string;
  userContent: string;
  /** A single forced tool; its `input_schema` is the desired JSON shape. */
  tool: { name: string; description: string; inputSchema: Record<string, unknown> };
  maxTokens?: number;
}

export interface StructuredResult {
  /** The raw `tool_use.input` — unvalidated; the caller re-checks with Zod. */
  data: unknown;
  model: string;
  latencyMs: number;
  usage: ClaudeUsage;
}

export interface TextRequest {
  operation: AiOperation;
  system: string;
  userContent: string;
  maxTokens?: number;
}

export interface TextResult {
  text: string;
  model: string;
  latencyMs: number;
  usage: ClaudeUsage;
}

export interface ClaudeClient {
  extractStructured(req: StructuredRequest): Promise<StructuredResult>;
  generateText(req: TextRequest): Promise<TextResult>;
}

function logCall(op: AiOperation, model: string, latencyMs: number, usage: ClaudeUsage): void {
  logger.info('ai.call', {
    operation: op,
    model,
    latencyMs,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });
}

function realClient(apiKey: string): ClaudeClient {
  const anthropic = new Anthropic({ apiKey, timeout: env.AI_REQUEST_TIMEOUT_MS, maxRetries: 1 });
  const model = env.ANTHROPIC_MODEL;

  return {
    async extractStructured(req) {
      const startedAt = Date.now();
      const message = await anthropic.messages.create({
        model,
        max_tokens: req.maxTokens ?? 1024,
        system: req.system,
        tools: [
          {
            name: req.tool.name,
            description: req.tool.description,
            input_schema: req.tool.inputSchema as Anthropic.Tool.InputSchema,
            strict: true,
          },
        ],
        tool_choice: { type: 'tool', name: req.tool.name },
        messages: [{ role: 'user', content: req.userContent }],
      });
      const latencyMs = Date.now() - startedAt;
      const usage: ClaudeUsage = {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      };
      logCall(req.operation, message.model, latencyMs, usage);
      const toolUse = message.content.find((block) => block.type === 'tool_use');
      return { data: toolUse?.input, model: message.model, latencyMs, usage };
    },

    async generateText(req) {
      const startedAt = Date.now();
      const message = await anthropic.messages.create({
        model,
        max_tokens: req.maxTokens ?? 512,
        system: req.system,
        messages: [{ role: 'user', content: req.userContent }],
      });
      const latencyMs = Date.now() - startedAt;
      const usage: ClaudeUsage = {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      };
      logCall(req.operation, message.model, latencyMs, usage);
      const text = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
      return { text, model: message.model, latencyMs, usage };
    },
  };
}

let memoized: ClaudeClient | null | undefined;
let testOverride: ClaudeClient | null | undefined;

/** Test-only injection point for a scripted fake client. */
export function setClaudeClientForTesting(client: ClaudeClient | null): void {
  if (!env.isTest) {
    throw new Error('setClaudeClientForTesting is only available under NODE_ENV=test');
  }
  testOverride = client;
}

/**
 * The configured Claude client, or `null` when the assistant is disabled
 * (`AI_ASSISTANT_ENABLED=false`) or has no API key. Memoised.
 */
export function getClaudeClient(): ClaudeClient | null {
  if (testOverride !== undefined) return testOverride;
  if (memoized === undefined) {
    memoized =
      env.AI_ASSISTANT_ENABLED && env.ANTHROPIC_API_KEY ? realClient(env.ANTHROPIC_API_KEY) : null;
  }
  return memoized;
}
