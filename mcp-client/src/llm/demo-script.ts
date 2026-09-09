import { lastToolResult, type ScriptStep } from './scripted.js';

/**
 * The canned "conversation" for `--scripted` mode — a deterministic offline
 * demo that needs no API key. It ignores the user's typed text and always runs
 * the same check-then-book flow against whatever the seeded database holds, so
 * it also serves as a smoke test of the transport wiring.
 *
 * Assumes the platform seed data (a `washing-machine-installation` service with
 * open slots). If there are none, `createBooking` returns an error and the
 * final line still prints.
 */
export const DEMO_SCRIPT: ScriptStep[] = [
  {
    call: [
      {
        name: 'checkAvailability',
        args: { serviceType: 'washing-machine-installation', date: '2026-09-10' },
      },
    ],
  },
  {
    callFrom: (history) => {
      const availability = lastToolResult(history, 'checkAvailability') as
        { slots?: Array<{ slotId: string }> } | undefined;
      const slotId = availability?.slots?.[0]?.slotId;
      if (!slotId) {
        return [
          {
            name: 'checkAvailability',
            args: { serviceType: 'washing-machine-installation', date: '2026-09-11' },
          },
        ];
      }
      return [
        {
          name: 'createBooking',
          args: { serviceType: 'washing-machine-installation', slot: slotId },
        },
      ];
    },
  },
  {
    say: 'Done — I checked real availability and attempted a booking. See the trace above for the tool results.',
  },
];
