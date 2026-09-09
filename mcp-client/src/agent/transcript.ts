import type { LlmMessage } from '../llm/client.js';

/** A fresh, empty conversation. */
export function newTranscript(): LlmMessage[] {
  return [];
}

export type AgentStepEvent =
  | { type: 'model_text'; text: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; isError: boolean; payload: unknown }
  | { type: 'iteration_limit'; maxIterations: number };

/** One compact line per step, for the stderr trace. */
export function renderStep(event: AgentStepEvent): string {
  switch (event.type) {
    case 'model_text':
      return `  · model: ${truncate(event.text, 100)}`;
    case 'tool_call':
      return `  → ${event.name}(${JSON.stringify(event.args)})`;
    case 'tool_result': {
      if (event.isError) {
        const err = (event.payload as { error?: { code?: string; message?: string } })?.error;
        return `  ← ${event.name} error ${err?.code ?? '?'}: ${err?.message ?? ''}`;
      }
      return `  ← ${event.name} ok: ${truncate(JSON.stringify(event.payload), 140)}`;
    }
    case 'iteration_limit':
      return `  ! stopped after ${event.maxIterations} steps`;
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
