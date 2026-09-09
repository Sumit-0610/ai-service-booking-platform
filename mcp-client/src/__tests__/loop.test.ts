/* eslint-disable @typescript-eslint/no-explicit-any -- fake MCP payloads */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { describe, expect, it, vi } from 'vitest';
import { runAgentTurn } from '../agent/loop.js';
import { SYSTEM_PROMPT } from '../agent/prompt.js';
import { newTranscript } from '../agent/transcript.js';
import type { LlmClient, LlmGenerateResult } from '../llm/client.js';

/**
 * Pure loop tests with a fake MCP client and a fake LLM — no DB, no server.
 * Covers the control-flow branches the DB integration test does not force:
 * iteration cap, multiple tool calls in one model turn, unknown tool, and
 * model prose emitted alongside a tool call.
 */

function fakeMcp(overrides?: Partial<Pick<Client, 'callTool'>>): Client {
  return {
    listTools: vi.fn(async () => ({
      tools: [
        { name: 'alpha', description: 'a', inputSchema: { type: 'object', properties: {} } },
        { name: 'beta', description: 'b', inputSchema: { type: 'object', properties: {} } },
      ],
    })),
    callTool: vi.fn(async ({ name }: { name: string }) => ({
      content: [{ type: 'text', text: JSON.stringify({ tool: name, ok: true }) }],
      isError: false,
    })),
    ...overrides,
  } as unknown as Client;
}

/** An LLM that returns each scripted result in order, then loops on the last. */
function fakeLlm(results: LlmGenerateResult[]): LlmClient {
  let i = 0;
  return {
    generate: vi.fn(async () => results[Math.min(i++, results.length - 1)]!),
  };
}

const USAGE = { inputTokens: 0, outputTokens: 0 };
const META = { usage: USAGE, model: 'fake', latencyMs: 0 };

async function run(llm: LlmClient, mcp: Client, opts?: { maxIterations?: number }) {
  const history = newTranscript();
  const result = await runAgentTurn({
    llm,
    mcp,
    system: SYSTEM_PROMPT,
    history,
    userMessage: 'go',
    maxIterations: opts?.maxIterations ?? 8,
  });
  return { result, history };
}

describe('runAgentTurn', () => {
  it('stops at maxIterations when the model never finishes', async () => {
    const llm = fakeLlm([
      { kind: 'tool_calls', calls: [{ id: '1', name: 'alpha', args: {} }], ...META },
    ]);
    const { result } = await run(llm, fakeMcp(), { maxIterations: 3 });
    expect(result.hitLimit).toBe(true);
    expect(result.iterations).toBe(3);
    expect(result.answer).toMatch(/within 3 steps/);
  });

  it('executes multiple tool calls from a single model turn, then finishes', async () => {
    const mcp = fakeMcp();
    const llm = fakeLlm([
      {
        kind: 'tool_calls',
        calls: [
          { id: '1', name: 'alpha', args: { x: 1 } },
          { id: '2', name: 'beta', args: { y: 2 } },
        ],
        ...META,
      },
      { kind: 'text', text: 'both done', ...META },
    ]);
    const { result, history } = await run(llm, mcp);
    expect(result.answer).toBe('both done');
    expect(result.iterations).toBe(2);
    expect(mcp.callTool).toHaveBeenCalledTimes(2);
    const toolTurn = history.find((m) => m.toolResults);
    expect(toolTurn?.toolResults).toHaveLength(2);
  });

  it('synthesizes an error for an unknown tool without calling the server', async () => {
    const mcp = fakeMcp();
    const llm = fakeLlm([
      { kind: 'tool_calls', calls: [{ id: '1', name: 'ghost', args: {} }], ...META },
      { kind: 'text', text: 'ok', ...META },
    ]);
    const { history } = await run(llm, mcp);
    expect(mcp.callTool).not.toHaveBeenCalled();
    const res = history.find((m) => m.toolResults)?.toolResults?.[0];
    expect(res?.isError).toBe(true);
    expect((res?.response as any).error.message).toContain('No such tool: ghost');
  });

  it('records model prose emitted alongside a tool call', async () => {
    const llm = fakeLlm([
      {
        kind: 'tool_calls',
        text: 'let me check that',
        calls: [{ id: '1', name: 'alpha', args: {} }],
        ...META,
      },
      { kind: 'text', text: 'done', ...META },
    ]);
    const { history } = await run(llm, fakeMcp());
    const modelTurn = history.find((m) => m.toolCalls);
    expect(modelTurn?.text).toBe('let me check that');
  });

  it('feeds a transport failure back as a retryable INTERNAL error, not a throw', async () => {
    const mcp = fakeMcp({
      callTool: vi.fn(async () => {
        throw new Error('socket hang up');
      }),
    });
    const llm = fakeLlm([
      { kind: 'tool_calls', calls: [{ id: '1', name: 'alpha', args: {} }], ...META },
      { kind: 'text', text: 'gave up gracefully', ...META },
    ]);
    const { result, history } = await run(llm, mcp);
    expect(result.answer).toBe('gave up gracefully');
    const res = history.find((m) => m.toolResults)?.toolResults?.[0];
    expect(res?.isError).toBe(true);
    expect((res?.response as any).error.code).toBe('INTERNAL');
  });
});
