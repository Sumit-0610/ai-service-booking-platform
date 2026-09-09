/* eslint-disable @typescript-eslint/no-explicit-any -- tool payloads fed back
   into the loop are parsed JSON; asserting on them untyped reads better here. */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '@aisbp/database';
import { prisma } from '@aisbp/database/testing';
import { resolveActor } from '@aisbp/mcp-server/context';
import { buildServer } from '@aisbp/mcp-server/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAgentTurn } from '../agent/loop.js';
import { SYSTEM_PROMPT } from '../agent/prompt.js';
import { newTranscript } from '../agent/transcript.js';
import { getLlmClient, setLlmClientForTesting } from '../llm/client.js';
import { lastToolResult, scriptedLlmClient, type ScriptStep } from '../llm/scripted.js';

/**
 * The full loop, exercised against the real `mcp-server` (in-memory transport)
 * and a real database, with a deterministic scripted LLM. No Gemini API call.
 * Fixtures prefixed `mcpclienttest-`; this suite owns the DB lifecycle.
 */

const P = 'mcpclienttest-';
const SERVICE_SLUG = `${P}widget-install`;
const CUSTOMER_EMAIL = `${P}cust@example.com`;
const CUSTOMER_ID = `${P}cust`;
const TECH_ID = `${P}tech`;

interface Slot {
  id: string;
  date: string;
}

let slotSeq = 0;
async function makeSlot(): Promise<Slot> {
  slotSeq += 1;
  const id = `${P}slot-${slotSeq}`;
  const startsAt = new Date(Date.UTC(2027, 8, 1) + slotSeq * 3 * 3_600_000);
  await prisma.availabilitySlot.create({
    data: {
      id,
      technicianId: TECH_ID,
      serviceId: `${P}svc`,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
    },
  });
  return { id, date: startsAt.toISOString().slice(0, 10) };
}

async function cleanup(): Promise<void> {
  const bookingWhere = {
    OR: [{ customerId: CUSTOMER_ID }, { slot: { id: { startsWith: P } } }],
  };
  await prisma.bookingStatusHistory.deleteMany({ where: { booking: bookingWhere } });
  await prisma.booking.deleteMany({ where: bookingWhere });
  await prisma.availabilitySlot.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.technician.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.service.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.serviceCategory.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.address.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

async function seed(): Promise<void> {
  await prisma.serviceCategory.create({
    data: { id: `${P}cat`, name: 'MCP Client Test', slug: `${P}cat`, description: 'x' },
  });
  await prisma.service.create({
    data: {
      id: `${P}svc`,
      categoryId: `${P}cat`,
      name: 'MCP Widget Install',
      slug: SERVICE_SLUG,
      description: 'x',
      basePriceCents: 5000,
      currency: 'USD',
      estimatedDurationMinutes: 60,
    },
  });
  await prisma.user.create({
    data: {
      id: CUSTOMER_ID,
      email: CUSTOMER_EMAIL,
      passwordHash: 'x',
      name: 'Cleo Client',
      role: 'customer',
    },
  });
  await prisma.address.create({
    data: {
      id: `${P}addr`,
      userId: CUSTOMER_ID,
      label: 'Home',
      line1: '1 Loop St',
      line2: null,
      city: 'Testville',
      state: 'TS',
      postalCode: '00000',
      country: 'US',
    },
  });
  await prisma.user.create({
    data: {
      id: `${P}techuser`,
      email: `${P}tech@example.com`,
      passwordHash: 'x',
      name: 'Tess Tech',
      role: 'technician',
    },
  });
  await prisma.technician.create({
    data: {
      id: TECH_ID,
      userId: `${P}techuser`,
      displayName: 'Tess Tech',
      serviceArea: 'Testville',
      active: true,
    },
  });
}

let client: Client;
let server: ReturnType<typeof buildServer>;

async function runTurn(script: ScriptStep[], message: string) {
  const history = newTranscript();
  const result = await runAgentTurn({
    llm: scriptedLlmClient(script),
    mcp: client,
    system: SYSTEM_PROMPT,
    history,
    userMessage: message,
    maxIterations: 6,
  });
  return { result, history };
}

beforeAll(async () => {
  await connectDatabase();
  await cleanup();
  await seed();
  const actor = await resolveActor(CUSTOMER_EMAIL);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  server = buildServer(actor);
  client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
});

afterAll(async () => {
  await Promise.allSettled([client?.close(), server?.close()]);
  await cleanup();
  await disconnectDatabase();
});

describe('agent loop over the real MCP server', () => {
  it('checks real availability, books a real slot, and reports back', async () => {
    const slot = await makeSlot();

    const script: ScriptStep[] = [
      {
        call: [{ name: 'checkAvailability', args: { serviceType: SERVICE_SLUG, date: slot.date } }],
      },
      {
        callFrom: (history) => {
          const availability = lastToolResult(history, 'checkAvailability') as {
            slots: Array<{ slotId: string }>;
          };
          return [
            {
              name: 'createBooking',
              args: { serviceType: SERVICE_SLUG, slot: availability.slots[0]!.slotId },
            },
          ];
        },
      },
      { say: 'Booked — your appointment is pending.' },
    ];

    const { result } = await runTurn(script, 'book me a widget install');
    expect(result.hitLimit).toBe(false);
    expect(result.iterations).toBe(3);
    expect(result.answer).toContain('Booked');

    const booking = await prisma.booking.findFirst({
      where: { customerId: CUSTOMER_ID, slot: { id: slot.id } },
      include: { slot: true },
    });
    expect(booking?.status).toBe('pending');
    expect(booking?.slot.status).toBe('booked');
    expect(booking?.priceTotalCents).toBe(5000);
  });

  it('returns real availability without booking anything', async () => {
    const slot = await makeSlot();
    const before = await prisma.booking.count({ where: { customerId: CUSTOMER_ID } });

    const { result, history } = await runTurn(
      [
        {
          call: [
            { name: 'checkAvailability', args: { serviceType: SERVICE_SLUG, date: slot.date } },
          ],
        },
        { say: 'There is one slot that day.' },
      ],
      'what is open',
    );

    const availability = lastToolResult(history, 'checkAvailability') as any;
    expect(availability.slots.map((s: any) => s.slotId)).toContain(slot.id);
    expect(result.answer).toContain('slot');
    expect(await prisma.booking.count({ where: { customerId: CUSTOMER_ID } })).toBe(before);
  });

  it('feeds a tool error back into the conversation instead of throwing', async () => {
    const { result, history } = await runTurn(
      [
        {
          call: [
            {
              name: 'createBooking',
              args: { serviceType: SERVICE_SLUG, slot: 'mcpclienttest-nope-000' },
            },
          ],
        },
        { say: 'That slot is not available, sorry.' },
      ],
      'book slot mcpclienttest-nope-000',
    );

    const toolTurn = history.find((m) => m.toolResults)?.toolResults?.[0];
    expect(toolTurn?.isError).toBe(true);
    expect((toolTurn?.response as any).error.code).toMatch(/VALIDATION_ERROR|NOT_FOUND/);
    expect(result.answer).toContain('not available');
  });

  it('synthesizes an error for an unknown tool name without calling the server', async () => {
    const { history } = await runTurn(
      [{ call: [{ name: 'deleteEverything', args: {} }] }, { say: 'I cannot do that.' }],
      'delete everything',
    );
    const toolTurn = history.find((m) => m.toolResults)?.toolResults?.[0];
    expect(toolTurn?.isError).toBe(true);
    expect((toolTurn?.response as any).error.message).toContain('No such tool');
  });
});

describe('LLM client selection', () => {
  it('returns null without an API key and honours the test override', () => {
    expect(getLlmClient({ geminiApiKey: undefined, geminiModel: 'x' })).toBeNull();
    const fake = scriptedLlmClient([{ say: 'hi' }]);
    setLlmClientForTesting(fake);
    expect(getLlmClient({ geminiApiKey: undefined, geminiModel: 'x' })).toBe(fake);
    setLlmClientForTesting(null);
  });
});
