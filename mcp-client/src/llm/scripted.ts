import type { LlmClient, LlmGenerateRequest, LlmGenerateResult, LlmMessage } from './client.js';

/**
 * A deterministic, in-process fake `LlmClient` — the equivalent of
 * `stubClaudeClient` / the scripted fake in the M14 AI integration test. No
 * network, no API key. Consumes one step per `generate()` call; over-running
 * the script throws (so a loop bug surfaces as a test failure, not a hang).
 *
 * Used by the loop integration test and by the CLI's `--scripted` demo mode.
 */

export interface ScriptedCall {
  name: string;
  args: Record<string, unknown>;
}

export type ScriptStep =
  | { say: string }
  | { call: ScriptedCall[] }
  /** Build the calls from the conversation so far — e.g. read a real `slotId`
   *  out of the previous `checkAvailability` result. */
  | { callFrom: (history: LlmMessage[]) => ScriptedCall[] };

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0 } as const;

/** The last `toolResults` entry for a given tool name, or `undefined`. */
export function lastToolResult(history: LlmMessage[], toolName: string): unknown {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const results = history[i]?.toolResults;
    const hit = results?.find((r) => r.name === toolName && !r.isError);
    if (hit) return hit.response;
  }
  return undefined;
}

export function scriptedLlmClient(steps: ScriptStep[]): LlmClient {
  let cursor = 0;

  return {
    generate(req: LlmGenerateRequest): Promise<LlmGenerateResult> {
      const step = steps[cursor];
      cursor += 1;
      if (!step) {
        throw new Error(`scriptedLlmClient: script exhausted after ${steps.length} step(s)`);
      }

      if ('say' in step) {
        return Promise.resolve({
          kind: 'text',
          text: step.say,
          usage: ZERO_USAGE,
          model: 'scripted',
          latencyMs: 0,
        });
      }

      const calls = 'call' in step ? step.call : step.callFrom(req.history);
      return Promise.resolve({
        kind: 'tool_calls',
        calls: calls.map((c, i) => ({ id: `scripted_${cursor}_${i}`, name: c.name, args: c.args })),
        usage: ZERO_USAGE,
        model: 'scripted',
        latencyMs: 0,
      });
    },
  };
}
