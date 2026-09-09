import { describe, expect, it, vi } from 'vitest';
import { Guardrails, permissiveGuardrails } from '../agent/guardrails.js';
import type { LlmToolCall } from '../llm/client.js';

const call = (name: string): LlmToolCall => ({ id: '1', name, args: {} });

describe('Guardrails', () => {
  it('always allows read tools and never counts them', async () => {
    const g = new Guardrails({ maxWrites: 0 });
    for (const name of ['checkAvailability', 'getBookingDetails']) {
      const d = await g.check(call(name));
      expect(d).toEqual({ allow: true, isWrite: false });
    }
    expect(g.writesUsed).toBe(0);
  });

  it('confirms each write tool and counts approvals', async () => {
    const confirm = vi.fn(async () => true);
    const g = new Guardrails({ maxWrites: 5, confirm });

    expect(await g.check(call('createBooking'))).toEqual({ allow: true, isWrite: true });
    expect(await g.check(call('cancelOrReschedule'))).toEqual({ allow: true, isWrite: true });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(g.writesUsed).toBe(2);
  });

  it('blocks a write the user declines, without spending the budget', async () => {
    const g = new Guardrails({ maxWrites: 5, confirm: async () => false });
    const d = await g.check(call('createBooking'));
    expect(d).toMatchObject({ allow: false, code: 'FORBIDDEN' });
    expect(g.writesUsed).toBe(0);
  });

  it('enforces the per-conversation write cap even when every prompt says yes', async () => {
    const g = new Guardrails({ maxWrites: 2, confirm: async () => true });
    expect((await g.check(call('createBooking'))).allow).toBe(true);
    expect((await g.check(call('createBooking'))).allow).toBe(true);
    const third = await g.check(call('createBooking'));
    expect(third).toMatchObject({ allow: false, code: 'FORBIDDEN' });
    expect((third as { reason: string }).reason).toMatch(/limit of 2/);
    expect(g.writesUsed).toBe(2);
  });

  it('permissiveGuardrails allows writes with no prompt', async () => {
    const g = permissiveGuardrails(3);
    expect((await g.check(call('createBooking'))).allow).toBe(true);
  });
});
