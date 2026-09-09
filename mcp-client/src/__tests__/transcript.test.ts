import { describe, expect, it } from 'vitest';
import { newTranscript, renderStep } from '../agent/transcript.js';

describe('newTranscript', () => {
  it('starts empty', () => {
    expect(newTranscript()).toEqual([]);
  });
});

describe('renderStep', () => {
  it('renders each event type as one line', () => {
    expect(
      renderStep({ type: 'tool_call', name: 'checkAvailability', args: { date: '2027-01-01' } }),
    ).toBe('  → checkAvailability({"date":"2027-01-01"})');
    expect(
      renderStep({
        type: 'tool_result',
        name: 'checkAvailability',
        isError: false,
        payload: { slotCount: 2 },
      }),
    ).toContain('← checkAvailability ok');
    expect(
      renderStep({
        type: 'tool_result',
        name: 'createBooking',
        isError: true,
        payload: { error: { code: 'CONFLICT', message: 'slot taken' } },
      }),
    ).toBe('  ← createBooking error CONFLICT: slot taken');
    expect(renderStep({ type: 'model_text', text: 'hello there' })).toContain('model: hello there');
    expect(renderStep({ type: 'iteration_limit', maxIterations: 8 })).toBe(
      '  ! stopped after 8 steps',
    );
  });

  it('truncates long values', () => {
    const line = renderStep({ type: 'model_text', text: 'x'.repeat(500) });
    expect(line.length).toBeLessThan(120);
    expect(line.endsWith('…')).toBe(true);
  });
});
