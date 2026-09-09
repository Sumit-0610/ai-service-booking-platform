import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '@aisbp/database';
import { prisma } from '@aisbp/database/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveActor } from '../context.js';
import { startHttpServer, type HttpServerHandle } from '../http.js';

/**
 * The Streamable HTTP transport, end to end: a real `Client` connects over HTTP
 * to `startHttpServer`, lists the 4 tools, and calls one against the real DB.
 * Fixtures prefixed `httptest-`.
 */

const P = 'httptest-';
const SERVICE_SLUG = `${P}widget-install`;
const CUSTOMER_EMAIL = `${P}cust@example.com`;
const DAY = '2027-10-01';
const SLOT_AT = `${DAY}T09:00:00.000Z`;

async function cleanup(): Promise<void> {
  await prisma.bookingStatusHistory.deleteMany({
    where: { booking: { slot: { id: { startsWith: P } } } },
  });
  await prisma.booking.deleteMany({ where: { slot: { id: { startsWith: P } } } });
  await prisma.availabilitySlot.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.technician.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.service.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.serviceCategory.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

async function seed(): Promise<void> {
  await prisma.serviceCategory.create({
    data: { id: `${P}cat`, name: 'HTTP Test', slug: `${P}cat`, description: 'x' },
  });
  await prisma.service.create({
    data: {
      id: `${P}svc`,
      categoryId: `${P}cat`,
      name: 'HTTP Widget Install',
      slug: SERVICE_SLUG,
      description: 'x',
      basePriceCents: 4200,
      currency: 'USD',
      estimatedDurationMinutes: 60,
    },
  });
  await prisma.user.create({
    data: {
      id: `${P}cust`,
      email: CUSTOMER_EMAIL,
      passwordHash: 'x',
      name: 'Hettie HTTP',
      role: 'customer',
    },
  });
  await prisma.user.create({
    data: {
      id: `${P}techuser`,
      email: `${P}tech@example.com`,
      passwordHash: 'x',
      name: 'Ty Tech',
      role: 'technician',
    },
  });
  await prisma.technician.create({
    data: {
      id: `${P}tech`,
      userId: `${P}techuser`,
      displayName: 'Ty Tech',
      serviceArea: 'Testville',
      active: true,
    },
  });
  await prisma.availabilitySlot.create({
    data: {
      id: `${P}slot-1`,
      technicianId: `${P}tech`,
      serviceId: `${P}svc`,
      startsAt: new Date(SLOT_AT),
      endsAt: new Date(new Date(SLOT_AT).getTime() + 3_600_000),
    },
  });
}

let handle: HttpServerHandle;
let client: Client;

beforeAll(async () => {
  await connectDatabase();
  await cleanup();
  await seed();
  const actor = await resolveActor(CUSTOMER_EMAIL);
  handle = await startHttpServer(actor, { port: 0 });

  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${handle.port}/mcp`),
  );
  client = new Client({ name: 'http-test', version: '0.0.0' });
  await client.connect(transport as Transport);
});

afterAll(async () => {
  await Promise.allSettled([client?.close(), handle?.close()]);
  await cleanup();
  await disconnectDatabase();
});

describe('Streamable HTTP transport', () => {
  it('lists the four booking tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['cancelOrReschedule', 'checkAvailability', 'createBooking', 'getBookingDetails'].sort(),
    );
  });

  it('runs checkAvailability against the real database over HTTP', async () => {
    const result = await client.callTool({
      name: 'checkAvailability',
      arguments: { serviceType: SERVICE_SLUG, date: DAY },
    });
    expect(result.isError ?? false).toBe(false);
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
    const data = JSON.parse(text) as { slotCount: number; slots: Array<{ slotId: string }> };
    expect(data.slotCount).toBe(1);
    expect(data.slots[0]?.slotId).toBe(`${P}slot-1`);
  });

  it('rejects an unknown path with 404', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/nope`);
    expect(res.status).toBe(404);
  });
});
