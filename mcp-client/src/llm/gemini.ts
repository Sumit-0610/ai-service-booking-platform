import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  Type,
  type Content,
  type FunctionDeclaration,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type Part,
  type Schema,
} from '@google/genai';
import { logger } from '../logger.js';
import type {
  LlmClient,
  LlmGenerateRequest,
  LlmGenerateResult,
  LlmMessage,
  LlmToolCall,
} from './client.js';
import type { GeminiSchema, ToolDeclaration } from './schema.js';

/**
 * The real Gemini implementation of `LlmClient` (Gemini Developer API, free
 * tier). Modelled on `realClient()` in `apps/api/src/lib/claude.ts`: one
 * `generateContent` round-trip per `generate()` call — the multi-turn loop
 * lives in `agent/loop.ts`, not here — plus safe-metadata-only logging (never
 * the prompt or the response text), one backoff retry on transient failures,
 * and a per-call timeout.
 *
 * `geminiClientFromGenerator` takes the one function it needs
 * (`generateContent`), so tests drive it with a fake and no network / no key.
 */

// ---------------------------------------------------------------------------
// JSON-Schema (our sanitized subset) -> Gemini `Schema`
// ---------------------------------------------------------------------------

const TYPE_BY_JSON: Record<string, Type> = {
  string: Type.STRING,
  number: Type.NUMBER,
  integer: Type.INTEGER,
  boolean: Type.BOOLEAN,
  array: Type.ARRAY,
  object: Type.OBJECT,
  null: Type.NULL,
};

export function toGeminiSchema(node: GeminiSchema): Schema {
  const out: Schema = {};
  if (node.type) out.type = TYPE_BY_JSON[node.type] ?? Type.STRING;
  if (node.description) out.description = node.description;
  if (node.nullable) out.nullable = true;
  if (node.enum && node.enum.length > 0) {
    out.enum = node.enum.map((v) => String(v));
    out.format = 'enum';
    out.type ??= Type.STRING;
  } else if (node.format) {
    out.format = node.format;
  }
  if (node.properties) {
    out.type ??= Type.OBJECT;
    out.properties = Object.fromEntries(
      Object.entries(node.properties).map(([k, v]) => [k, toGeminiSchema(v)]),
    );
  }
  if (node.required && node.required.length > 0) out.required = node.required;
  if (node.items) {
    out.type ??= Type.ARRAY;
    out.items = toGeminiSchema(node.items);
  }
  return out;
}

export function toFunctionDeclaration(tool: ToolDeclaration): FunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: toGeminiSchema(tool.parameters),
  };
}

// ---------------------------------------------------------------------------
// Conversation history <-> Gemini `Content[]`
// ---------------------------------------------------------------------------

/**
 * Wrap a tool result for `functionResponse.response`, which Gemini requires to
 * be a JSON object and reads by convention: an `output` key is the function's
 * value, an `error` key is an error. Our error payloads are already
 * `{ error: {...} }`, so they pass through; successes are nested under `output`.
 */
function toFunctionResponsePayload(response: unknown, isError: boolean): Record<string, unknown> {
  if (isError) {
    if (typeof response === 'object' && response !== null && 'error' in response) {
      return response as Record<string, unknown>;
    }
    return { error: response };
  }
  return { output: response };
}

export function toContents(history: LlmMessage[]): Content[] {
  return history.map((message): Content => {
    if (message.toolCalls) {
      const parts: Part[] = [];
      if (message.text) parts.push({ text: message.text });
      for (const call of message.toolCalls) {
        const part: Part = { functionCall: { id: call.id, name: call.name, args: call.args } };
        // Gemini 3.x rejects the follow-up turn unless the signature it issued
        // is echoed back on the functionCall part.
        if (call.providerSignature) part.thoughtSignature = call.providerSignature;
        parts.push(part);
      }
      return { role: 'model', parts };
    }
    if (message.toolResults) {
      return {
        role: 'user',
        parts: message.toolResults.map((result): Part => ({
          functionResponse: {
            id: result.id,
            name: result.name,
            response: toFunctionResponsePayload(result.response, result.isError),
          },
        })),
      };
    }
    return { role: message.role, parts: [{ text: message.text ?? '' }] };
  });
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export type GenerateContent = (
  params: GenerateContentParameters,
) => Promise<GenerateContentResponse>;

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 60_000;

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface GeminiClientOptions {
  timeoutMs?: number;
  maxRetries?: number;
}

export function geminiClientFromGenerator(
  generateContent: GenerateContent,
  model: string,
  options: GeminiClientOptions = {},
): LlmClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? 1;

  return {
    async generate(req: LlmGenerateRequest): Promise<LlmGenerateResult> {
      const contents = toContents(req.history);
      const functionDeclarations = req.tools.map(toFunctionDeclaration);
      const params: GenerateContentParameters = {
        model,
        contents,
        config: {
          abortSignal: AbortSignal.timeout(timeoutMs),
          systemInstruction: req.system,
          tools: [{ functionDeclarations }],
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        },
      };

      const startedAt = Date.now();
      let response: GenerateContentResponse | undefined;
      for (let attempt = 0; ; attempt += 1) {
        try {
          response = await generateContent(params);
          break;
        } catch (error) {
          if (attempt >= maxRetries || !RETRYABLE.has(statusOf(error) ?? 0)) {
            throw error;
          }
          await delay(500 * (attempt + 1));
        }
      }

      const latencyMs = Date.now() - startedAt;
      const usage = {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      };
      const resolvedModel = response.modelVersion ?? model;
      logger.info('ai.call', {
        operation: 'agent',
        model: resolvedModel,
        latencyMs,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });

      // Parse candidate parts directly (rather than the `functionCalls` / `text`
      // getters) so we can pair each `functionCall` with its `thoughtSignature`
      // and skip the model's internal `thought` parts.
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .filter((p) => typeof p.text === 'string' && !p.thought)
        .map((p) => p.text)
        .join('')
        .trim();
      const fnParts = parts.filter((p) => p.functionCall);

      if (fnParts.length > 0) {
        const result: LlmGenerateResult = {
          kind: 'tool_calls',
          calls: fnParts.map((part, i) => {
            const call: LlmToolCall = {
              id: part.functionCall?.id ?? `call_${i}`,
              name: part.functionCall?.name ?? '',
              args: (part.functionCall?.args ?? {}) as Record<string, unknown>,
            };
            if (part.thoughtSignature) call.providerSignature = part.thoughtSignature;
            return call;
          }),
          usage,
          model: resolvedModel,
          latencyMs,
        };
        if (text) result.text = text;
        return result;
      }

      return { kind: 'text', text, usage, model: resolvedModel, latencyMs };
    },
  };
}

export function realGeminiClient(
  apiKey: string,
  model: string,
  options?: GeminiClientOptions,
): LlmClient {
  const ai = new GoogleGenAI({ apiKey });
  return geminiClientFromGenerator((params) => ai.models.generateContent(params), model, options);
}
