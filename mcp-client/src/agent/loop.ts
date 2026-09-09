import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { LlmClient, LlmMessage, LlmToolCall, LlmToolResult } from '../llm/client.js';
import { toFunctionDeclarations } from '../llm/schema.js';
import type { AgentStepEvent } from './transcript.js';

/**
 * The agentic loop: user message -> model -> tool_use -> execute via the MCP
 * client -> tool_result -> model -> final text.
 *
 * It is server-authoritative, not client-enforcing: if the model calls
 * `createBooking` with a fabricated slot, the loop still forwards it; the
 * server's schema rejects it with a structured error, which the loop feeds
 * back so the model can recover. The only hard client-side guard is the
 * iteration cap.
 */

export interface RunAgentTurnOptions {
  llm: LlmClient;
  mcp: Client;
  system: string;
  /** The running conversation; mutated in place. */
  history: LlmMessage[];
  userMessage: string;
  maxIterations?: number;
  onStep?: (event: AgentStepEvent) => void;
}

export interface RunAgentTurnResult {
  answer: string;
  iterations: number;
  hitLimit: boolean;
}

interface McpTextContent {
  type: string;
  text: string;
}

function parseToolContent(content: unknown): unknown {
  const text = Array.isArray(content)
    ? (content as McpTextContent[]).find((c) => c.type === 'text')?.text
    : undefined;
  if (typeof text !== 'string') {
    return { raw: content };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function runAgentTurn(opts: RunAgentTurnOptions): Promise<RunAgentTurnResult> {
  const maxIterations = opts.maxIterations ?? 8;
  const onStep = opts.onStep ?? (() => {});

  const { tools } = await opts.mcp.listTools();
  const declarations = toFunctionDeclarations(tools);
  const knownToolNames = new Set(tools.map((t) => t.name));

  opts.history.push({ role: 'user', text: opts.userMessage });

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const result = await opts.llm.generate({
      system: opts.system,
      history: opts.history,
      tools: declarations,
    });

    if (result.kind === 'text') {
      opts.history.push({ role: 'model', text: result.text });
      onStep({ type: 'model_text', text: result.text });
      return { answer: result.text, iterations: iteration, hitLimit: false };
    }

    if (result.text) {
      onStep({ type: 'model_text', text: result.text });
    }
    opts.history.push(
      result.text
        ? { role: 'model', text: result.text, toolCalls: result.calls }
        : { role: 'model', toolCalls: result.calls },
    );
    const toolResults: LlmToolResult[] = [];
    for (const call of result.calls) {
      onStep({ type: 'tool_call', name: call.name, args: call.args });
      const outcome = await executeToolCall(opts.mcp, knownToolNames, call);
      onStep({
        type: 'tool_result',
        name: call.name,
        isError: outcome.isError,
        payload: outcome.response,
      });
      toolResults.push(outcome);
    }
    opts.history.push({ role: 'user', toolResults });
  }

  onStep({ type: 'iteration_limit', maxIterations });
  const answer = `I couldn't finish that within ${maxIterations} steps — please narrow the request or try again.`;
  opts.history.push({ role: 'model', text: answer });
  return { answer, iterations: maxIterations, hitLimit: true };
}

async function executeToolCall(
  mcp: Client,
  knownToolNames: Set<string>,
  call: LlmToolCall,
): Promise<LlmToolResult> {
  if (!knownToolNames.has(call.name)) {
    return {
      id: call.id,
      name: call.name,
      isError: true,
      response: {
        error: {
          code: 'VALIDATION_ERROR',
          message: `No such tool: ${call.name}. Available tools: ${[...knownToolNames].join(', ')}.`,
        },
      },
    };
  }

  try {
    const raw = await mcp.callTool({ name: call.name, arguments: call.args });
    return {
      id: call.id,
      name: call.name,
      isError: raw.isError === true,
      response: parseToolContent(raw.content),
    };
  } catch (error) {
    // Transport / protocol failure (not a tool-domain error). Surface it to the
    // model as a retryable error rather than throwing out of the loop.
    return {
      id: call.id,
      name: call.name,
      isError: true,
      response: {
        error: {
          code: 'INTERNAL',
          message: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }
}
