/* eslint-disable @typescript-eslint/no-explicit-any -- tool results are parsed
   JSON-RPC payloads; asserting on them reads better untyped than with a dozen
   local response interfaces. */
import 'dotenv/config';
import { connectDatabase, disconnectDatabase, repositories } from '@aisbp/database';
import { prisma } from '@aisbp/database/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveActor } from '../context.js';
import { buildServer } from '../server.js';

/**
 * Integration tests for the four MCP booking tools. They require a migrated and
 * seeded PostgreSQL database at DATABASE_URL (the same setup the
 * `@aisbp/database` integration suite needs). Every fixture row is prefixed
 * `mcptest-` so cleanup is exact and reruns are safe.
 *
 * Note the platform rule (Milestone 9): cancelling a booking does NOT free its
 * slot. So mutation tests mint their own slots with `makeSlot()` rather than
 * sharing a pool; the two read-only slots on `RO_DAY` are never booked.
 */

const RO_DAY = '2027-03-01';
const RO_DAY2 = '2027-03-02';

const P = 'mcptest-';
const SERVICE_ID = `${P}svc`;
const SERVICE_SLUG = `${P}widget-install`;
const CUSTOMER_ID = `${P}cust`;
const CUSTOMER_EMAIL = `${P}cust@example.com`;
const CUSTOMER2_ID = `${P}cust2`;
const CUSTOMER2_EMAIL = `${P}cust2@example.com`;
const TECH_ID = `${P}tech`;

async function cleanup(): Promise<void> {
  const bookingWhere = {
    OR: [
      { id: { startsWith: P } },
      { customerId: { in: [CUSTOMER_ID, CUSTOMER2_ID] } },
      { slot: { id: { startsWith: P } } },
    ],
  };
  await prisma.bookingStatusHistory.deleteMany({ where: { booking: bookingWhere } });
  await prisma.booking.deleteMany({ where: bookingWhere });
  await prisma.availabilitySlot.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.technicianService.deleteMany({ where: { technicianId: { startsWith: P } } });
  await prisma.technician.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.service.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.serviceCategory.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.address.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

let slotSeq = 0;

/** Mint a fresh 1-hour available slot at a unique far-future time. */
async function makeSlot(): Promise<string> {
  slotSeq += 1;
  const id = `${P}slot-${slotSeq}`;
  const startsAt = new Date(Date.UTC(2027, 5, 1) + slotSeq * 3 * 3_600_000);
  await prisma.availabilitySlot.create({
    data: {
      id,
      technicianId: TECH_ID,
      serviceId: SERVICE_ID,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
    },
  });
  return id;
}

async function seedFixtures(): Promise<void> {
  await prisma.serviceCategory.create({
    data: { id: `${P}cat`, name: 'MCP Test', slug: `${P}cat`, description: 'x' },
  });
  await prisma.service.create({
    data: {
      id: SERVICE_ID,
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
      name: 'Casey Customer',
      role: 'customer',
    },
  });
  await prisma.address.create({
    data: {
      id: `${P}addr`,
      userId: CUSTOMER_ID,
      label: 'Home',
      line1: '1 Test St',
      line2: null,
      city: 'Testville',
      state: 'TS',
      postalCode: '00000',
      country: 'US',
    },
  });
  await prisma.user.create({
    data: {
      id: CUSTOMER2_ID,
      email: CUSTOMER2_EMAIL,
      passwordHash: 'x',
      name: 'Dana Diode',
      role: 'customer',
    },
  });
  await prisma.address.createMany({
    data: ['addr2a', 'addr2b'].map((suffix, i) => ({
      id: `${P}${suffix}`,
      userId: CUSTOMER2_ID,
      label: i === 0 ? 'Flat' : 'Office',
      line1: `${i + 2} Test Ave`,
      line2: null,
      city: 'Testville',
      state: 'TS',
      postalCode: '00000',
      country: 'US',
    })),
  });
  await prisma.user.create({
    data: {
      id: `${P}techuser`,
      email: `${P}tech@example.com`,
      passwordHash: 'x',
      name: 'Terry Tech',
      role: 'technician',
    },
  });
  await prisma.technician.create({
    data: {
      id: TECH_ID,
      userId: `${P}techuser`,
      displayName: 'Terry Tech',
      serviceArea: 'Testville North',
      active: true,
    },
  });
  // Read-only slots for the checkAvailability suite — never booked.
  await prisma.availabilitySlot.createMany({
    data: [
      { suffix: 'ro-1', at: `${RO_DAY}T09:00:00.000Z` },
      { suffix: 'ro-2', at: `${RO_DAY}T11:00:00.000Z` },
      { suffix: 'ro-3', at: `${RO_DAY2}T09:00:00.000Z` },
    ].map(({ suffix, at }) => ({
      id: `${P}${suffix}`,
      technicianId: TECH_ID,
      serviceId: SERVICE_ID,
      startsAt: new Date(at),
      endsAt: new Date(new Date(at).getTime() + 3_600_000),
    })),
  });
}

/** A connected client + server pair acting as `actorEmail`. */
async function connectAs(actorEmail: string) {
  const actor = await resolveActor(actorEmail);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(actor);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
    let data: Record<string, any>;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    return { isError: result.isError ?? false, data };
  };

  return { client, server, call };
}

let main: Awaited<ReturnType<typeof connectAs>>;
let other: Awaited<ReturnType<typeof connectAs>>;

beforeAll(async () => {
  await connectDatabase();
  await cleanup();
  await seedFixtures();
  main = await connectAs(CUSTOMER_EMAIL);
  other = await connectAs(CUSTOMER2_EMAIL);
});

afterAll(async () => {
  await Promise.allSettled([
    main?.client.close(),
    main?.server.close(),
    other?.client.close(),
    other?.server.close(),
  ]);
  await cleanup();
  await disconnectDatabase();
});

describe('startup / actor resolution', () => {
  it('refuses a non-customer actor', async () => {
    await expect(resolveActor('tomas@tech.example.com')).rejects.toThrow(
      /only acts for customers/i,
    );
  });
  it('refuses an unknown actor', async () => {
    await expect(resolveActor('nobody@nowhere.example')).rejects.toThrow(/does not match/i);
  });
});

describe('tool registration', () => {
  it('exposes exactly the four booking tools with usable descriptions', async () => {
    const { tools } = await main.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['cancelOrReschedule', 'checkAvailability', 'createBooking', 'getBookingDetails'].sort(),
    );
    for (const tool of tools) {
      expect((tool.description ?? '').length).toBeGreaterThan(40);
      expect(tool.inputSchema).toBeDefined();
    }
  });
});

describe('checkAvailability', () => {
  it('returns real open slots for a service by slug', async () => {
    const { isError, data } = await main.call('checkAvailability', {
      serviceType: SERVICE_SLUG,
      date: RO_DAY,
    });
    expect(isError).toBe(false);
    expect(data.service.slug).toBe(SERVICE_SLUG);
    expect(data.slotCount).toBe(2);
    expect(data.slots.map((s: any) => s.slotId).sort()).toEqual([`${P}ro-1`, `${P}ro-2`].sort());
    expect(data.slots[0].technician).toBe('Terry Tech');
  });

  it('matches a service by display name, case-insensitively', async () => {
    const { data } = await main.call('checkAvailability', {
      serviceType: 'mcp widget install',
      date: RO_DAY2,
    });
    expect(data.service.slug).toBe(SERVICE_SLUG);
    expect(data.slotCount).toBe(1);
  });

  it('filters by location against the technician service area', async () => {
    const hit = await main.call('checkAvailability', {
      serviceType: SERVICE_SLUG,
      date: RO_DAY,
      location: 'north',
    });
    expect(hit.data.slotCount).toBe(2);
    const miss = await main.call('checkAvailability', {
      serviceType: SERVICE_SLUG,
      date: RO_DAY,
      location: 'South Bay',
    });
    expect(miss.data.slotCount).toBe(0);
  });

  it('is an error for an unknown service', async () => {
    const { isError, data } = await main.call('checkAvailability', {
      serviceType: 'no-such-service',
      date: RO_DAY,
    });
    expect(isError).toBe(true);
    expect(data.error.code).toBe('NOT_FOUND');
  });

  it('rejects a malformed date with the standard envelope, before any DB call', async () => {
    const { isError, data } = await main.call('checkAvailability', {
      serviceType: SERVICE_SLUG,
      date: '01-03-2027',
    });
    expect(isError).toBe(true);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(data.error.details)).toMatch(/calendar date|YYYY-MM-DD/i);
  });
});

describe('createBooking / getBookingDetails', () => {
  it('creates a real pending booking priced from the service, then reads it back', async () => {
    const slot = await makeSlot();
    const created = await main.call('createBooking', { serviceType: SERVICE_SLUG, slot });
    expect(created.isError).toBe(false);
    expect(created.data.status).toBe('pending');
    expect(created.data.price.totalCents).toBe(5000);
    expect(created.data.customerName).toBe('Casey Customer');
    expect(created.data.address.label).toBe('Home');

    const fetched = await main.call('getBookingDetails', { bookingId: created.data.bookingId });
    expect(fetched.isError).toBe(false);
    expect(fetched.data.bookingId).toBe(created.data.bookingId);
    expect(fetched.data.statusHistory.at(-1).to).toBe('pending');

    const again = await main.call('createBooking', { serviceType: SERVICE_SLUG, slot });
    expect(again.isError).toBe(true);
    expect(again.data.error.code).toBe('CONFLICT');
  });

  it('rejects a slot that belongs to a different service', async () => {
    const slot = await makeSlot();
    const { isError, data } = await main.call('createBooking', {
      serviceType: 'washing-machine-installation', // a real seeded service
      slot,
    });
    expect(isError).toBe(true);
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires addressId when the customer has several addresses, and honours it', async () => {
    const slot = await makeSlot();
    const ambiguous = await other.call('createBooking', { serviceType: SERVICE_SLUG, slot });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.data.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(ambiguous.data.error.details)).toContain(`${P}addr2b`);

    const picked = await other.call('createBooking', {
      serviceType: SERVICE_SLUG,
      slot,
      addressId: `${P}addr2b`,
    });
    expect(picked.isError).toBe(false);
    expect(picked.data.address.label).toBe('Office');
  });

  it('rejects an addressId the customer does not own', async () => {
    const slot = await makeSlot();
    const { isError, data } = await other.call('createBooking', {
      serviceType: SERVICE_SLUG,
      slot,
      addressId: `${P}addr`, // belongs to CUSTOMER_ID
    });
    expect(isError).toBe(true);
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });

  it('is NOT_FOUND for an unknown booking', async () => {
    const { isError, data } = await main.call('getBookingDetails', {
      bookingId: 'mcptest-nope-000',
    });
    expect(isError).toBe(true);
    expect(data.error.code).toBe('NOT_FOUND');
  });

  it("cannot read another customer's booking (IDOR -> NOT_FOUND)", async () => {
    const slot = await makeSlot();
    const mine = await main.call('createBooking', { serviceType: SERVICE_SLUG, slot });
    expect(mine.isError).toBe(false);
    const peek = await other.call('getBookingDetails', { bookingId: mine.data.bookingId });
    expect(peek.isError).toBe(true);
    expect(peek.data.error.code).toBe('NOT_FOUND');
  });
});

describe('cancelOrReschedule', () => {
  it('reschedules a booking to another open slot and frees the old one', async () => {
    const from = await makeSlot();
    const to = await makeSlot();
    const created = await main.call('createBooking', { serviceType: SERVICE_SLUG, slot: from });
    expect(created.isError).toBe(false);

    const moved = await main.call('cancelOrReschedule', {
      bookingId: created.data.bookingId,
      action: 'reschedule',
      newSlot: to,
    });
    expect(moved.isError).toBe(false);

    const oldSlot = await repositories.mcp.findSlotById(from);
    const newSlot = await repositories.mcp.findSlotById(to);
    expect(oldSlot?.status).toBe('available');
    expect(newSlot?.status).toBe('booked');
  });

  it("will not reschedule another customer's booking (IDOR -> NOT_FOUND)", async () => {
    const from = await makeSlot();
    const to = await makeSlot();
    const created = await main.call('createBooking', { serviceType: SERVICE_SLUG, slot: from });
    const attempt = await other.call('cancelOrReschedule', {
      bookingId: created.data.bookingId,
      action: 'reschedule',
      newSlot: to,
    });
    expect(attempt.isError).toBe(true);
    expect(attempt.data.error.code).toBe('NOT_FOUND');
  });

  it('will not reschedule an assigned booking (operations only)', async () => {
    const from = await makeSlot();
    const to = await makeSlot();
    const created = await main.call('createBooking', { serviceType: SERVICE_SLUG, slot: from });
    await prisma.booking.update({
      where: { id: created.data.bookingId },
      data: { status: 'assigned' },
    });
    const attempt = await main.call('cancelOrReschedule', {
      bookingId: created.data.bookingId,
      action: 'reschedule',
      newSlot: to,
    });
    expect(attempt.isError).toBe(true);
    expect(attempt.data.error.code).toBe('CONFLICT');
  });

  it('lets exactly one of two concurrent reschedules onto the same slot win', async () => {
    const [s1, s2, target] = [await makeSlot(), await makeSlot(), await makeSlot()];
    const b1 = await main.call('createBooking', { serviceType: SERVICE_SLUG, slot: s1 });
    const b2 = await main.call('createBooking', { serviceType: SERVICE_SLUG, slot: s2 });
    expect(b1.isError || b2.isError).toBe(false);

    const [r1, r2] = await Promise.all([
      main.call('cancelOrReschedule', {
        bookingId: b1.data.bookingId,
        action: 'reschedule',
        newSlot: target,
      }),
      main.call('cancelOrReschedule', {
        bookingId: b2.data.bookingId,
        action: 'reschedule',
        newSlot: target,
      }),
    ]);
    const wins = [r1, r2].filter((r) => !r.isError);
    const losses = [r1, r2].filter((r) => r.isError);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect(losses[0]!.data.error.code).toBe('CONFLICT');
  });

  it('cancels a booking', async () => {
    const slot = await makeSlot();
    const created = await main.call('createBooking', { serviceType: SERVICE_SLUG, slot });
    const cancelled = await main.call('cancelOrReschedule', {
      bookingId: created.data.bookingId,
      action: 'cancel',
    });
    expect(cancelled.isError).toBe(false);
    expect(cancelled.data.status).toBe('cancelled');
  });

  it('requires newSlot when action is reschedule (standard envelope)', async () => {
    const { isError, data } = await main.call('cancelOrReschedule', {
      bookingId: 'mcptest-whatever-1',
      action: 'reschedule',
    });
    expect(isError).toBe(true);
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });
});
