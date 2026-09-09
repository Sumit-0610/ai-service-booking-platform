/* eslint-disable @typescript-eslint/no-explicit-any -- shaping fake genai responses */
import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';
import type { LlmMessage } from '../llm/client.js';
import {
  geminiClientFromGenerator,
  toContents,
  toFunctionDeclaration,
  toGeminiSchema,
  type GenerateContent,
} from '../llm/gemini.js';

/**
 * Unit tests for the Gemini boundary with a fake `generateContent` — no network,
 * no `GEMINI_API_KEY`. These pin the request mapping and response parsing that
 * a live call would otherwise be the only check of.
 */

const TOOLS = [
  {
    name: 'checkAvailability',
    description: 'open slots',
    parameters: {
      type: 'object',
      properties: { serviceType: { type: 'string', description: 'slug' } },
      required: ['serviceType'],
    },
  },
];

function fakeResponse(partial: Partial<GenerateContentResponse>): GenerateContentResponse {
  return {
    functionCalls: undefined,
    text: undefined,
    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 },
    modelVersion: 'gemini-2.0-flash-001',
    ...partial,
  } as GenerateContentResponse;
}

describe('toGeminiSchema', () => {
  it('maps JSON types to the Type enum and marks enums', () => {
    const s = toGeminiSchema({
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'string', enum: ['x', 'y'] },
        c: { type: 'integer', nullable: true },
      },
      required: ['a'],
    });
    expect(s.type).toBe('OBJECT');
    expect(s.properties?.a?.type).toBe('STRING');
    expect(s.properties?.b?.enum).toEqual(['x', 'y']);
    expect(s.properties?.b?.format).toBe('enum');
    expect(s.properties?.c?.type).toBe('INTEGER');
    expect(s.properties?.c?.nullable).toBe(true);
    expect(s.required).toEqual(['a']);
  });
});

describe('toContents', () => {
  it('maps text / tool-call / tool-result turns and wraps responses by convention', () => {
    const history: LlmMessage[] = [
      { role: 'user', text: 'hi' },
      {
        role: 'model',
        text: 'checking',
        toolCalls: [{ id: 'c1', name: 'checkAvailability', args: { serviceType: 's' } }],
      },
      {
        role: 'user',
        toolResults: [
          { id: 'c1', name: 'checkAvailability', isError: false, response: { slots: [] } },
        ],
      },
      {
        role: 'user',
        toolResults: [
          {
            id: 'c2',
            name: 'createBooking',
            isError: true,
            response: { error: { code: 'CONFLICT' } },
          },
        ],
      },
    ];
    const contents = toContents(history);

    expect(contents[0]).toEqual({ role: 'user', parts: [{ text: 'hi' }] });

    const modelTurn = contents[1]!;
    expect(modelTurn.role).toBe('model');
    expect(modelTurn.parts?.[0]).toEqual({ text: 'checking' });
    expect(modelTurn.parts?.[1]?.functionCall?.name).toBe('checkAvailability');

    expect(contents[2]?.parts?.[0]?.functionResponse?.response).toEqual({ output: { slots: [] } });
    expect(contents[3]?.parts?.[0]?.functionResponse?.response).toEqual({
      error: { code: 'CONFLICT' },
    });
  });
});

describe('geminiClientFromGenerator', () => {
  const req = {
    system: 'be helpful',
    history: [{ role: 'user' as const, text: 'go' }],
    tools: TOOLS,
  };

  it('sends system instruction + tools + AUTO tool config', async () => {
    let seen: GenerateContentParameters | undefined;
    const gen: GenerateContent = async (params) => {
      seen = params;
      return fakeResponse({ text: 'hello' });
    };
    await geminiClientFromGenerator(gen, 'gemini-2.0-flash').generate(req);

    expect(seen?.model).toBe('gemini-2.0-flash');
    expect(seen?.config?.systemInstruction).toBe('be helpful');
    expect((seen?.config?.tools?.[0] as any)?.functionDeclarations?.[0]?.name).toBe(
      'checkAvailability',
    );
    expect(seen?.config?.toolConfig?.functionCallingConfig?.mode).toBe('AUTO');
  });

  it('returns tool_calls (with any prose) when the model calls a function', async () => {
    const gen: GenerateContent = async () =>
      fakeResponse({
        text: 'let me look',
        functionCalls: [{ id: 'f1', name: 'checkAvailability', args: { serviceType: 's' } }] as any,
      });
    const result = await geminiClientFromGenerator(gen, 'm').generate(req);
    expect(result.kind).toBe('tool_calls');
    if (result.kind === 'tool_calls') {
      expect(result.calls).toEqual([
        { id: 'f1', name: 'checkAvailability', args: { serviceType: 's' } },
      ]);
      expect(result.text).toBe('let me look');
      expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
      expect(result.model).toBe('gemini-2.0-flash-001');
    }
  });

  it('returns text when there are no function calls', async () => {
    const gen: GenerateContent = async () => fakeResponse({ text: 'all set' });
    const result = await geminiClientFromGenerator(gen, 'm').generate(req);
    expect(result).toMatchObject({ kind: 'text', text: 'all set' });
  });

  it('synthesizes a call id when the model omits one', async () => {
    const gen: GenerateContent = async () =>
      fakeResponse({ functionCalls: [{ name: 'checkAvailability', args: {} }] as any });
    const result = await geminiClientFromGenerator(gen, 'm').generate(req);
    if (result.kind === 'tool_calls') expect(result.calls[0]?.id).toBe('call_0');
  });

  it('retries once on a 429 then succeeds', async () => {
    const gen = vi
      .fn<GenerateContent>()
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }))
      .mockResolvedValueOnce(fakeResponse({ text: 'recovered' }));
    const result = await geminiClientFromGenerator(gen, 'm', { maxRetries: 1 }).generate(req);
    expect(gen).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ kind: 'text', text: 'recovered' });
  });

  it('does not retry a 400 and rethrows', async () => {
    const gen = vi
      .fn<GenerateContent>()
      .mockRejectedValue(Object.assign(new Error('bad request'), { status: 400 }));
    await expect(geminiClientFromGenerator(gen, 'm').generate(req)).rejects.toThrow('bad request');
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry budget', async () => {
    const gen = vi
      .fn<GenerateContent>()
      .mockRejectedValue(Object.assign(new Error('still down'), { status: 503 }));
    await expect(
      geminiClientFromGenerator(gen, 'm', { maxRetries: 1 }).generate(req),
    ).rejects.toThrow('still down');
    expect(gen).toHaveBeenCalledTimes(2);
  });
});

describe('toFunctionDeclaration', () => {
  it('produces a Gemini FunctionDeclaration from a ToolDeclaration', () => {
    const decl = toFunctionDeclaration(TOOLS[0]!);
    expect(decl.name).toBe('checkAvailability');
    expect(decl.parameters?.type).toBe('OBJECT');
    expect(decl.parameters?.required).toEqual(['serviceType']);
  });
});
