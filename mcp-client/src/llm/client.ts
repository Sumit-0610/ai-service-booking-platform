import { realGeminiClient } from './gemini.js';
import type { ToolDeclaration } from './schema.js';

export { realGeminiClient };

/**
 * The LLM boundary — modelled on `apps/api/src/lib/claude.ts`: an interface the
 * agent loop depends on, a real provider implementation, a memoised getter that
 * returns `null` when unconfigured, a test-only injection point, and a
 * deterministic scripted fake (`./scripted.ts`).
 *
 * The loop imports only the provider-neutral types below — never `@google/genai`.
 */

export type LlmRole = 'user' | 'model';

export interface LlmToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LlmToolResult {
  id: string;
  name: string;
  /** The tool's `data` on success, or `{ error: { code, message, details } }`. */
  response: unknown;
  isError: boolean;
}

/** One turn of the running conversation. */
export interface LlmMessage {
  role: LlmRole;
  text?: string;
  toolCalls?: LlmToolCall[];
  toolResults?: LlmToolResult[];
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmGenerateRequest {
  system: string;
  history: LlmMessage[];
  tools: ToolDeclaration[];
}

export type LlmGenerateResult =
  | { kind: 'tool_calls'; calls: LlmToolCall[]; usage: LlmUsage; model: string; latencyMs: number }
  | { kind: 'text'; text: string; usage: LlmUsage; model: string; latencyMs: number };

export interface LlmClient {
  generate(req: LlmGenerateRequest): Promise<LlmGenerateResult>;
}

// ---------------------------------------------------------------------------
// Selection + test seam (mirrors claude.ts)
// ---------------------------------------------------------------------------

let memoized: LlmClient | null | undefined;
let testOverride: LlmClient | null | undefined;

/** Test-only injection point for a scripted fake. */
export function setLlmClientForTesting(client: LlmClient | null): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('setLlmClientForTesting is only available under NODE_ENV=test');
  }
  testOverride = client;
}

export interface LlmClientConfig {
  geminiApiKey: string | undefined;
  geminiModel: string;
}

/**
 * The configured LLM client, or `null` when there is no `GEMINI_API_KEY`. The
 * CLI turns `null` into a friendly "get a free key / pass --scripted" exit,
 * mirroring how the REST assistant turns an absent key into a 503.
 */
export function getLlmClient(config: LlmClientConfig): LlmClient | null {
  if (testOverride !== undefined) {
    return testOverride;
  }
  if (memoized === undefined) {
    memoized = config.geminiApiKey
      ? realGeminiClient(config.geminiApiKey, config.geminiModel)
      : null;
  }
  return memoized;
}

/** Reset the memoised client — used by tests between cases. */
export function resetLlmClient(): void {
  memoized = undefined;
}
