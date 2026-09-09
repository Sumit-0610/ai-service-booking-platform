import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  Type,
  type Content,
  type FunctionDeclaration,
  type Part,
  type Schema,
} from '@google/genai';
import { logger } from '../logger.js';
import type { LlmClient, LlmGenerateRequest, LlmGenerateResult, LlmMessage } from './client.js';
import type { GeminiSchema, ToolDeclaration } from './schema.js';

/**
 * The real Gemini implementation of `LlmClient` (Gemini Developer API, free
 * tier). Modelled on `realClient()` in `apps/api/src/lib/claude.ts`: one
 * `generateContent` round-trip per `generate()` call — the multi-turn loop
 * lives in `agent/loop.ts`, not here — plus safe-metadata-only logging (never
 * the prompt or the response text) and one backoff retry on 429/503.
 */

const TYPE_BY_JSON: Record<string, Type> = {
  string: Type.STRING,
  number: Type.NUMBER,
  integer: Type.INTEGER,
  boolean: Type.BOOLEAN,
  array: Type.ARRAY,
  object: Type.OBJECT,
  null: Type.NULL,
};

function toGeminiSchema(node: GeminiSchema): Schema {
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

function toFunctionDeclaration(tool: ToolDeclaration): FunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: toGeminiSchema(tool.parameters),
  };
}

/** A function-response `response` must be a JSON object; wrap anything else. */
function asResponseObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { result: value };
}

function toContents(history: LlmMessage[]): Content[] {
  return history.map((message): Content => {
    if (message.toolCalls) {
      return {
        role: 'model',
        parts: message.toolCalls.map((call): Part => ({
          functionCall: { id: call.id, name: call.name, args: call.args },
        })),
      };
    }
    if (message.toolResults) {
      return {
        role: 'user',
        parts: message.toolResults.map((result): Part => ({
          functionResponse: {
            id: result.id,
            name: result.name,
            response: asResponseObject(result.response),
          },
        })),
      };
    }
    return { role: message.role, parts: [{ text: message.text ?? '' }] };
  });
}

const RETRYABLE = new Set([429, 500, 503, 504]);

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function realGeminiClient(apiKey: string, model: string): LlmClient {
  const ai = new GoogleGenAI({ apiKey });

  return {
    async generate(req: LlmGenerateRequest): Promise<LlmGenerateResult> {
      const contents = toContents(req.history);
      const functionDeclarations = req.tools.map(toFunctionDeclaration);
      const startedAt = Date.now();

      let response;
      for (let attempt = 0; ; attempt += 1) {
        try {
          response = await ai.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: req.system,
              tools: [{ functionDeclarations }],
              toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
            },
          });
          break;
        } catch (error) {
          if (attempt >= 1 || !RETRYABLE.has(statusOf(error) ?? 0)) {
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

      const calls = response.functionCalls ?? [];
      if (calls.length > 0) {
        return {
          kind: 'tool_calls',
          calls: calls.map((call, i) => ({
            id: call.id ?? `call_${i}`,
            name: call.name ?? '',
            args: (call.args ?? {}) as Record<string, unknown>,
          })),
          usage,
          model: resolvedModel,
          latencyMs,
        };
      }

      return { kind: 'text', text: response.text ?? '', usage, model: resolvedModel, latencyMs };
    },
  };
}
