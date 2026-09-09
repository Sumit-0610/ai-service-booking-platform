import type { LlmToolCall } from '../llm/client.js';

/**
 * Client-side guardrails: the "is this tool call safe to run" check that
 * happens in the loop *before* `mcp.callTool`, on top of (not instead of) the
 * server's Zod schema + actor-scoped re-grounding + DB constraints.
 *
 * The server is the authority — nothing here can be relied on for security in
 * isolation. These are defence-in-depth for the one gap the server can't close:
 * a prompt-injected or confused model issuing *unwanted* writes on the user's
 * own account (it still cannot touch anyone else's — that's the actor scope).
 *
 *  1. `createBooking` / `cancelOrReschedule` are irreversible-ish writes. In an
 *     interactive session each one is surfaced to the user for a yes/no before
 *     it runs.
 *  2. A per-conversation write cap stops a runaway loop from mass-booking or
 *     mass-cancelling even if every prompt says yes.
 *
 * A blocked call is not thrown — it is fed back to the model as a
 * `{ error: { code: 'FORBIDDEN' } }` result so it can explain the refusal.
 */

export const WRITE_TOOLS: ReadonlySet<string> = new Set(['createBooking', 'cancelOrReschedule']);

export type ConfirmFn = (call: LlmToolCall) => Promise<boolean>;

export interface GuardrailOptions {
  /** Max successful write-tool calls per conversation. */
  maxWrites: number;
  /** Interactive confirmation for write tools. Omit to auto-allow (scripted/CI). */
  confirm?: ConfirmFn | undefined;
}

export type GuardrailDecision =
  | { allow: true; isWrite: boolean }
  | { allow: false; isWrite: true; code: 'FORBIDDEN'; reason: string };

export class Guardrails {
  private writeCount = 0;

  constructor(private readonly options: GuardrailOptions) {}

  get writesUsed(): number {
    return this.writeCount;
  }

  async check(call: LlmToolCall): Promise<GuardrailDecision> {
    if (!WRITE_TOOLS.has(call.name)) {
      return { allow: true, isWrite: false };
    }

    if (this.writeCount >= this.options.maxWrites) {
      return {
        allow: false,
        isWrite: true,
        code: 'FORBIDDEN',
        reason:
          `This conversation has reached its limit of ${this.options.maxWrites} booking ` +
          'changes. Ask the customer to start a new session for further changes.',
      };
    }

    if (this.options.confirm) {
      const approved = await this.options.confirm(call);
      if (!approved) {
        return {
          allow: false,
          isWrite: true,
          code: 'FORBIDDEN',
          reason: 'The customer declined this action. Do not retry it; ask what they want instead.',
        };
      }
    }

    this.writeCount += 1;
    return { allow: true, isWrite: true };
  }
}

/** A permissive guardrail set — read-only tools plus a generous write cap, no
 *  prompt. For non-interactive contexts (`--scripted`, `verify:gemini`, tests). */
export function permissiveGuardrails(maxWrites = 25): Guardrails {
  return new Guardrails({ maxWrites });
}
