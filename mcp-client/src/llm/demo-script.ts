import type { LlmMessage } from './client.js';
import { lastToolResult, type ScriptStep } from './scripted.js';

/**
 * The canned "conversation" for `--scripted` mode — a deterministic offline
 * demo that needs no API key. It ignores the user's typed text and runs a
 * fixed check-then-book flow against whatever the seeded database holds, so it
 * also smoke-tests the transport wiring. It is intentionally dumb (a fake, not
 * a model): it makes at most one booking attempt and always prints a final
 * line, whatever the outcome.
 */
const SERVICE = 'washing-machine-installation';

function utcDatePlusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function firstSlotId(history: LlmMessage[]): string | undefined {
  const availability = lastToolResult(history, 'checkAvailability') as
    { slots?: Array<{ slotId: string }> } | undefined;
  return availability?.slots?.[0]?.slotId;
}

export const DEMO_SCRIPT: ScriptStep[] = [
  {
    call: [{ name: 'checkAvailability', args: { serviceType: SERVICE, date: utcDatePlusDays(4) } }],
  },
  {
    // Found something? book it. Otherwise widen the search once.
    callFrom: (history) => {
      const slotId = firstSlotId(history);
      return slotId
        ? [{ name: 'createBooking', args: { serviceType: SERVICE, slot: slotId } }]
        : [
            {
              name: 'checkAvailability',
              args: { serviceType: SERVICE, date: utcDatePlusDays(11) },
            },
          ];
    },
  },
  {
    callFrom: (history) => {
      const booking = lastToolResult(history, 'createBooking') as
        { bookingId?: string } | undefined;
      if (booking?.bookingId) {
        // Booked on step 2 — confirm it.
        return [{ name: 'getBookingDetails', args: { bookingId: booking.bookingId } }];
      }
      const attempted = history.some((m) => m.toolCalls?.some((c) => c.name === 'createBooking'));
      const slotId = firstSlotId(history);
      return attempted || !slotId
        ? [{ name: 'checkAvailability', args: { serviceType: SERVICE, date: utcDatePlusDays(4) } }]
        : [{ name: 'createBooking', args: { serviceType: SERVICE, slot: slotId } }];
    },
  },
  {
    say: 'Done — I checked real availability and attempted a booking. See the trace above for the tool results.',
  },
];
