import { prisma } from '@aisbp/database/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  agent,
  closeConnections,
  freshIp,
  loginUser,
  registerUser,
  resetAuthState,
  uniqueEmail,
  type AuthCookies,
} from '../../test/helpers.js';

/**
 * Booking workflow integration tests. Require a migrated + seeded PostgreSQL
 * (the transaction / `Booking.slotId` UNIQUE behaviour is exercised for real)
 * and a reachable Redis for sessions.
 */

const P = 'bktest-';
const ACTIVE_SLUG = `${P}active-service`;
const INACTIVE_SLUG = `${P}inactive-service`;

let activeServiceId = '';
let inactiveServiceId = '';
let technicianId = '';
let otherTechnicianId = '';
let technicianCookies: AuthCookies;

interface Customer {
  userId: string;
  cookies: AuthCookies;
  addressId: string;
}

async function makeCustomer(tag: string): Promise<Customer> {
  const email = uniqueEmail(`cust-${tag}`);
  await registerUser(email);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const address = await prisma.address.create({
    data: {
      id: `${P}addr-${tag}-${user.id.slice(-6)}`,
      userId: user.id,
      label: 'Home',
      line1: '12 MG Road',
      city: 'Pune',
      state: 'Maharashtra',
      postalCode: '411001',
      country: 'IN',
    },
  });
  const cookies = await loginUser(email);
  return { userId: user.id, cookies, addressId: address.id };
}

async function makeTechnician(
  tag: string,
): Promise<{ technicianId: string; cookies: AuthCookies }> {
  const email = uniqueEmail(`tech-${tag}`);
  await registerUser(email);
  await prisma.user.update({ where: { email }, data: { role: 'technician' } });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const technician = await prisma.technician.create({
    data: {
      id: `${P}tech-${tag}-${user.id.slice(-6)}`,
      userId: user.id,
      displayName: `Tech ${tag}`,
      serviceArea: 'Test',
    },
  });
  const cookies = await loginUser(email);
  return { technicianId: technician.id, cookies };
}

function futureRange(days: number, hour = 9): { startsAt: Date; endsAt: Date } {
  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + days);
  startsAt.setUTCHours(hour, 0, 0, 0);
  const endsAt = new Date(startsAt);
  endsAt.setUTCHours(hour + 1, 0, 0, 0);
  return { startsAt, endsAt };
}

let slotSeq = 0;
async function makeSlot(opts: {
  serviceId: string;
  technicianId?: string;
  when?: { startsAt: Date; endsAt: Date };
  past?: boolean;
}): Promise<string> {
  slotSeq += 1;
  const when =
    opts.when ??
    (opts.past
      ? (() => {
          const startsAt = new Date(Date.now() - 3 * 3_600_000);
          const endsAt = new Date(Date.now() - 2 * 3_600_000);
          return { startsAt, endsAt };
        })()
      : futureRange(2 + slotSeq, 8 + (slotSeq % 8)));
  const slot = await prisma.availabilitySlot.create({
    data: {
      id: `${P}slot-${slotSeq}`,
      technicianId: opts.technicianId ?? technicianId,
      serviceId: opts.serviceId,
      startsAt: when.startsAt,
      endsAt: when.endsAt,
      status: 'available',
    },
  });
  return slot.id;
}

function post(path: string, cookies: AuthCookies, body?: Record<string, unknown>) {
  const req = agent()
    .post(path)
    .set('Cookie', cookies.header)
    .set('X-CSRF-Token', cookies.csrfToken)
    .set('X-Forwarded-For', freshIp());
  return body === undefined ? req : req.send(body);
}

async function cleanupData(): Promise<void> {
  await prisma.booking.deleteMany({ where: { slot: { id: { startsWith: P } } } });
  await prisma.availabilitySlot.deleteMany({ where: { id: { startsWith: P } } });
}

beforeAll(async () => {
  await resetAuthState();
  await prisma.booking.deleteMany({ where: { slot: { id: { startsWith: P } } } });
  await prisma.availabilitySlot.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.service.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.serviceCategory.deleteMany({ where: { slug: { startsWith: P } } });

  const category = await prisma.serviceCategory.create({
    data: { id: `${P}cat`, name: 'Booking test', slug: `${P}cat`, description: 'x' },
  });
  const active = await prisma.service.create({
    data: {
      id: `${P}svc-active`,
      categoryId: category.id,
      name: 'Booking Test Service',
      slug: ACTIVE_SLUG,
      description: 'x',
      basePriceCents: 10_000,
      currency: 'USD',
      estimatedDurationMinutes: 60,
      active: true,
    },
  });
  const inactive = await prisma.service.create({
    data: {
      id: `${P}svc-inactive`,
      categoryId: category.id,
      name: 'Inactive Booking Service',
      slug: INACTIVE_SLUG,
      description: 'x',
      basePriceCents: 10_000,
      currency: 'USD',
      estimatedDurationMinutes: 60,
      active: false,
    },
  });
  activeServiceId = active.id;
  inactiveServiceId = inactive.id;

  const tech = await makeTechnician('main');
  technicianId = tech.technicianId;
  technicianCookies = tech.cookies;
  const other = await makeTechnician('other');
  otherTechnicianId = other.technicianId;
});

beforeEach(cleanupData);

afterAll(async () => {
  // Bookings restrict deletion of their customer/address/service/slot, so they
  // must go before `resetAuthState` removes the users.
  await prisma.booking.deleteMany({ where: { slot: { id: { startsWith: P } } } });
  await prisma.availabilitySlot.deleteMany({ where: { id: { startsWith: P } } });
  await resetAuthState();
  await prisma.service.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.serviceCategory.deleteMany({ where: { slug: { startsWith: P } } });
  await closeConnections();
});

describe('POST /api/v1/bookings', () => {
  it('creates a pending booking with a server-side price snapshot and initial history', async () => {
    const customer = await makeCustomer('a1');
    const slotId = await makeSlot({ serviceId: activeServiceId });

    const res = await post('/api/v1/bookings', customer.cookies, {
      slotId,
      addressId: customer.addressId,
    });

    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({
      status: 'pending',
      service: { slug: ACTIVE_SLUG },
      price: {
        currency: 'USD',
        subtotalCents: 10_000,
        feesTotalCents: 0,
        discountTotalCents: 0,
        taxTotalCents: 0,
        totalCents: 10_000,
        breakdown: { lines: [{ label: 'Service', amountCents: 10_000 }] },
      },
    });
    expect(res.body.booking).not.toHaveProperty('customerId');
    expect(res.body.booking).not.toHaveProperty('technicianId');
    expect(res.body.booking).not.toHaveProperty('slotId');

    // slot moved to booked, and disappears from public availability
    const slot = await prisma.availabilitySlot.findUniqueOrThrow({ where: { id: slotId } });
    expect(slot.status).toBe('booked');

    const history = await agent()
      .get(`/api/v1/bookings/${res.body.booking.id}/status-history`)
      .set('Cookie', customer.cookies.header);
    expect(history.status).toBe(200);
    expect(history.body.items).toEqual([expect.objectContaining({ from: null, to: 'pending' })]);
  });

  it('keeps the price snapshot immutable when the service is later repriced', async () => {
    const customer = await makeCustomer('a2');
    const slotId = await makeSlot({ serviceId: activeServiceId });
    const created = await post('/api/v1/bookings', customer.cookies, {
      slotId,
      addressId: customer.addressId,
    });
    expect(created.status).toBe(201);

    await prisma.service.update({
      where: { id: activeServiceId },
      data: { basePriceCents: 25_000 },
    });

    const fetched = await agent()
      .get(`/api/v1/bookings/${created.body.booking.id}`)
      .set('Cookie', customer.cookies.header);
    expect(fetched.body.booking.price.totalCents).toBe(10_000);

    await prisma.service.update({
      where: { id: activeServiceId },
      data: { basePriceCents: 10_000 },
    });
  });

  it("rejects a booking for another customer's address", async () => {
    const owner = await makeCustomer('a3');
    const attacker = await makeCustomer('a4');
    const slotId = await makeSlot({ serviceId: activeServiceId });

    const res = await post('/api/v1/bookings', attacker.cookies, {
      slotId,
      addressId: owner.addressId,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an inactive service', async () => {
    const customer = await makeCustomer('a5');
    const slotId = await makeSlot({ serviceId: inactiveServiceId });

    const res = await post('/api/v1/bookings', customer.cookies, {
      slotId,
      addressId: customer.addressId,
    });
    expect(res.status).toBe(422);
  });

  it('rejects an unknown slot, a past slot, and an already-booked slot', async () => {
    const customer = await makeCustomer('a6');

    const unknown = await post('/api/v1/bookings', customer.cookies, {
      slotId: `${P}slot-does-not-exist`,
      addressId: customer.addressId,
    });
    expect(unknown.status).toBe(422);

    const pastSlot = await makeSlot({ serviceId: activeServiceId, past: true });
    const past = await post('/api/v1/bookings', customer.cookies, {
      slotId: pastSlot,
      addressId: customer.addressId,
    });
    expect(past.status).toBe(422);

    const slotId = await makeSlot({ serviceId: activeServiceId });
    const first = await post('/api/v1/bookings', customer.cookies, {
      slotId,
      addressId: customer.addressId,
    });
    expect(first.status).toBe(201);
    const second = await post('/api/v1/bookings', customer.cookies, {
      slotId,
      addressId: customer.addressId,
    });
    expect(second.status).toBe(409);
  });

  it('rejects mass-assignment fields', async () => {
    const customer = await makeCustomer('a7');
    const slotId = await makeSlot({ serviceId: activeServiceId });

    for (const extra of [
      { status: 'confirmed' },
      { technicianId: otherTechnicianId },
      { customerId: 'someone-else' },
      { priceTotalCents: 1 },
      { serviceId: inactiveServiceId },
      { scheduledStart: '2026-09-01T09:00:00.000Z' },
    ]) {
      const res = await post('/api/v1/bookings', customer.cookies, {
        slotId,
        addressId: customer.addressId,
        ...extra,
      });
      expect(res.status, JSON.stringify(extra)).toBe(422);
    }
  });

  it('requires a CSRF token', async () => {
    const customer = await makeCustomer('a8');
    const slotId = await makeSlot({ serviceId: activeServiceId });

    const res = await agent()
      .post('/api/v1/bookings')
      .set('Cookie', customer.cookies.header)
      .set('X-Forwarded-For', freshIp())
      .send({ slotId, addressId: customer.addressId });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_ERROR');
  });

  it('forbids operations and technician roles from creating bookings', async () => {
    const tech = await makeTechnician('nope');
    const slotId = await makeSlot({ serviceId: activeServiceId });
    const res = await post('/api/v1/bookings', tech.cookies, {
      slotId,
      addressId: `${P}addr-x`,
    });
    expect(res.status).toBe(403);
  });

  it('lets exactly one of two concurrent requests win the same slot', async () => {
    const a = await makeCustomer('c1');
    const b = await makeCustomer('c2');
    const slotId = await makeSlot({ serviceId: activeServiceId });

    const [r1, r2] = await Promise.all([
      post('/api/v1/bookings', a.cookies, { slotId, addressId: a.addressId }),
      post('/api/v1/bookings', b.cookies, { slotId, addressId: b.addressId }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const bookings = await prisma.booking.count({ where: { slotId } });
    expect(bookings).toBe(1);
  });
});

describe('GET /api/v1/bookings (ownership)', () => {
  it("only returns the caller's own bookings and 404s on another customer's id", async () => {
    const a = await makeCustomer('o1');
    const b = await makeCustomer('o2');
    const slotId = await makeSlot({ serviceId: activeServiceId });
    const created = await post('/api/v1/bookings', a.cookies, {
      slotId,
      addressId: a.addressId,
    });
    const bookingId = created.body.booking.id;

    const listB = await agent().get('/api/v1/bookings').set('Cookie', b.cookies.header);
    expect(listB.body.items).toEqual([]);

    for (const path of [
      `/api/v1/bookings/${bookingId}`,
      `/api/v1/bookings/${bookingId}/status-history`,
    ]) {
      const res = await agent().get(path).set('Cookie', b.cookies.header);
      expect(res.status, path).toBe(404);
    }
    const cancelB = await post(`/api/v1/bookings/${bookingId}/cancel`, b.cookies);
    expect(cancelB.status).toBe(404);
  });
});

describe('POST /api/v1/bookings/:id/cancel', () => {
  it('cancels a pending booking and appends history', async () => {
    const customer = await makeCustomer('x1');
    const slotId = await makeSlot({ serviceId: activeServiceId });
    const created = await post('/api/v1/bookings', customer.cookies, {
      slotId,
      addressId: customer.addressId,
    });
    const bookingId = created.body.booking.id;

    const res = await post(`/api/v1/bookings/${bookingId}/cancel`, customer.cookies);
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('cancelled');

    const history = await agent()
      .get(`/api/v1/bookings/${bookingId}/status-history`)
      .set('Cookie', customer.cookies.header);
    expect(history.body.items.map((e: { to: string }) => e.to)).toEqual(['pending', 'cancelled']);
  });

  it('rejects an invalid transition (double cancel) with 409', async () => {
    const customer = await makeCustomer('x2');
    const slotId = await makeSlot({ serviceId: activeServiceId });
    const created = await post('/api/v1/bookings', customer.cookies, {
      slotId,
      addressId: customer.addressId,
    });
    const bookingId = created.body.booking.id;

    expect((await post(`/api/v1/bookings/${bookingId}/cancel`, customer.cookies)).status).toBe(200);
    const again = await post(`/api/v1/bookings/${bookingId}/cancel`, customer.cookies);
    expect(again.status).toBe(409);
  });

  it('requires a CSRF token to cancel', async () => {
    const customer = await makeCustomer('x3');
    const slotId = await makeSlot({ serviceId: activeServiceId });
    const created = await post('/api/v1/bookings', customer.cookies, {
      slotId,
      addressId: customer.addressId,
    });

    const res = await agent()
      .post(`/api/v1/bookings/${created.body.booking.id}/cancel`)
      .set('Cookie', customer.cookies.header)
      .set('X-Forwarded-For', freshIp());
    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/bookings — search, filter, pagination (Milestone 12)', () => {
  async function seedBookings(customer: Customer, n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const slotId = await makeSlot({ serviceId: activeServiceId });
      const res = await post('/api/v1/bookings', customer.cookies, {
        slotId,
        addressId: customer.addressId,
      });
      expect(res.status).toBe(201);
      ids.push(res.body.booking.id);
    }
    return ids;
  }

  it('paginates with correct metadata and a deterministic order', async () => {
    const customer = await makeCustomer('p1');
    await seedBookings(customer, 5);

    const p1 = await agent()
      .get('/api/v1/bookings?limit=2&page=1&sort=created_asc')
      .set('Cookie', customer.cookies.header);
    expect(p1.status).toBe(200);
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.pagination).toEqual({
      page: 1,
      limit: 2,
      total: 5,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: false,
    });

    const p2 = await agent()
      .get('/api/v1/bookings?limit=2&page=2&sort=created_asc')
      .set('Cookie', customer.cookies.header);
    const p3 = await agent()
      .get('/api/v1/bookings?limit=2&page=3&sort=created_asc')
      .set('Cookie', customer.cookies.header);
    expect(p3.body.items).toHaveLength(1);
    expect(p3.body.pagination).toMatchObject({ hasNextPage: false, hasPreviousPage: true });

    const ids = [p1, p2, p3].flatMap((r) => r.body.items.map((b: { id: string }) => b.id));
    expect(new Set(ids).size).toBe(5); // no overlap / skips

    // page past the end -> empty, not an error
    const past = await agent()
      .get('/api/v1/bookings?limit=2&page=9')
      .set('Cookie', customer.cookies.header);
    expect(past.status).toBe(200);
    expect(past.body.items).toEqual([]);
    expect(past.body.pagination.hasNextPage).toBe(false);

    // repeat page 1 -> identical order
    const p1again = await agent()
      .get('/api/v1/bookings?limit=2&page=1&sort=created_asc')
      .set('Cookie', customer.cookies.header);
    expect(p1again.body.items.map((b: { id: string }) => b.id)).toEqual(
      p1.body.items.map((b: { id: string }) => b.id),
    );
  });

  it('filters by status and sorts both directions', async () => {
    const customer = await makeCustomer('p2');
    const ids = await seedBookings(customer, 3);
    const cancelledId = ids[0]!;
    await prisma.booking.update({ where: { id: cancelledId }, data: { status: 'cancelled' } });

    const pending = await agent()
      .get('/api/v1/bookings?status=pending')
      .set('Cookie', customer.cookies.header);
    expect(pending.body.items.every((b: { status: string }) => b.status === 'pending')).toBe(true);
    expect(pending.body.pagination.total).toBe(2);

    const cancelled = await agent()
      .get('/api/v1/bookings?status=cancelled')
      .set('Cookie', customer.cookies.header);
    expect(cancelled.body.items.map((b: { id: string }) => b.id)).toEqual([cancelledId]);

    const asc = await agent()
      .get('/api/v1/bookings?sort=created_asc')
      .set('Cookie', customer.cookies.header);
    const desc = await agent()
      .get('/api/v1/bookings?sort=created_desc')
      .set('Cookie', customer.cookies.header);
    expect(asc.body.items.map((b: { id: string }) => b.id)).toEqual(
      [...desc.body.items].reverse().map((b: { id: string }) => b.id),
    );
  });

  it('rejects invalid pagination / filter / sort values with 422 and ignores unknown params', async () => {
    const customer = await makeCustomer('p3');
    for (const q of [
      '?limit=0',
      '?limit=51',
      '?page=0',
      '?page=abc',
      '?status=nonsense',
      '?sort=weird',
    ]) {
      const res = await agent().get(`/api/v1/bookings${q}`).set('Cookie', customer.cookies.header);
      expect(res.status, q).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const injected = await agent()
      .get('/api/v1/bookings?customerId=someone&where[id]=x&select=password')
      .set('Cookie', customer.cookies.header);
    expect(injected.status).toBe(200);
    expect(injected.body.items).toEqual([]);
  });
});

describe('technician booking visibility', () => {
  it("shows the job to the slot's technician only, and denies customers / anon", async () => {
    const customer = await makeCustomer('t1');
    const slotId = await makeSlot({ serviceId: activeServiceId, technicianId });
    const created = await post('/api/v1/bookings', customer.cookies, {
      slotId,
      addressId: customer.addressId,
    });
    const bookingId = created.body.booking.id;

    const mine = await agent()
      .get('/api/v1/technician/bookings')
      .set('Cookie', technicianCookies.header);
    expect(mine.status).toBe(200);
    expect(mine.body.items.map((b: { id: string }) => b.id)).toContain(bookingId);
    expect(mine.body.items[0]).toHaveProperty('customerName');
    expect(mine.body.items[0]).not.toHaveProperty('price');

    const asCustomer = await agent()
      .get('/api/v1/technician/bookings')
      .set('Cookie', customer.cookies.header);
    expect(asCustomer.status).toBe(403);

    const anon = await agent().get('/api/v1/technician/bookings');
    expect(anon.status).toBe(401);
  });
});
