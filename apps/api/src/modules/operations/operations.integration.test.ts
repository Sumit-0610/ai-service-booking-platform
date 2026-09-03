import { prisma } from '@aisbp/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
 * Operations Dashboard integration tests. Require a migrated + seeded PostgreSQL
 * and a reachable Redis for sessions. Bookings for state-transition tests are
 * created through the real customer booking API; extra rows for dashboard
 * counting are created directly.
 */

const P = 'optest-';
const SLUG = `${P}service`;

let serviceId = '';
let technicianId = '';
let opsCookies: AuthCookies;
let opsUserName = '';
let customer: { cookies: AuthCookies; addressId: string };

async function makeUser(role: 'operations' | 'customer' | 'technician', tag: string) {
  const email = uniqueEmail(`${role}-${tag}`);
  await registerUser(email);
  if (role !== 'customer') {
    await prisma.user.update({ where: { email }, data: { role } });
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const cookies = await loginUser(email);
  return { email, userId: user.id, name: user.name, cookies };
}

let slotSeq = 0;
async function makeSlot(): Promise<string> {
  slotSeq += 1;
  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + 2 + slotSeq);
  startsAt.setUTCHours(8 + (slotSeq % 8), 0, 0, 0);
  const endsAt = new Date(startsAt);
  endsAt.setUTCHours(startsAt.getUTCHours() + 1, 0, 0, 0);
  const slot = await prisma.availabilitySlot.create({
    data: {
      id: `${P}slot-${slotSeq}`,
      technicianId,
      serviceId,
      startsAt,
      endsAt,
      status: 'available',
    },
  });
  return slot.id;
}

/** Book a fresh slot as the test customer; returns the booking id. */
async function bookViaApi(): Promise<string> {
  const slotId = await makeSlot();
  const res = await agent()
    .post('/api/v1/bookings')
    .set('Cookie', customer.cookies.header)
    .set('X-CSRF-Token', customer.cookies.csrfToken)
    .set('X-Forwarded-For', freshIp())
    .send({ slotId, addressId: customer.addressId });
  expect(res.status).toBe(201);
  return res.body.booking.id;
}

function opsPatch(id: string, body?: Record<string, unknown>) {
  const req = agent()
    .patch(`/api/v1/operations/bookings/${id}/status`)
    .set('Cookie', opsCookies.header)
    .set('X-CSRF-Token', opsCookies.csrfToken)
    .set('X-Forwarded-For', freshIp());
  return body === undefined ? req : req.send(body);
}

async function cleanup(): Promise<void> {
  await prisma.booking.deleteMany({ where: { slot: { id: { startsWith: P } } } });
  await prisma.availabilitySlot.deleteMany({ where: { id: { startsWith: P } } });
}

beforeAll(async () => {
  await resetAuthState();
  await cleanup();
  await prisma.service.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.serviceCategory.deleteMany({ where: { slug: { startsWith: P } } });

  const category = await prisma.serviceCategory.create({
    data: { id: `${P}cat`, name: 'Ops test', slug: `${P}cat`, description: 'x' },
  });
  const service = await prisma.service.create({
    data: {
      id: `${P}svc`,
      categoryId: category.id,
      name: 'Ops Test Service',
      slug: SLUG,
      description: 'x',
      basePriceCents: 10_000,
      currency: 'USD',
      estimatedDurationMinutes: 60,
      active: true,
    },
  });
  serviceId = service.id;

  const ops = await makeUser('operations', 'a');
  opsCookies = ops.cookies;
  opsUserName = ops.name;

  const tech = await makeUser('technician', 'a');
  const technician = await prisma.technician.create({
    data: {
      id: `${P}tech`,
      userId: tech.userId,
      displayName: 'Ops Test Tech',
      serviceArea: 'Test',
    },
  });
  technicianId = technician.id;

  const cust = await makeUser('customer', 'a');
  const address = await prisma.address.create({
    data: {
      id: `${P}addr`,
      userId: cust.userId,
      label: 'Home',
      line1: '1 Test St',
      city: 'Pune',
      state: 'MH',
      postalCode: '411001',
      country: 'IN',
    },
  });
  customer = { cookies: cust.cookies, addressId: address.id };
});

afterAll(async () => {
  await cleanup();
  await resetAuthState();
  await prisma.service.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.serviceCategory.deleteMany({ where: { slug: { startsWith: P } } });
  await closeConnections();
});

describe('operations authorization', () => {
  it('enforces the operations role on every endpoint', async () => {
    const tech = await makeUser('technician', 'z');
    const cust = await makeUser('customer', 'z');

    for (const path of ['/api/v1/operations/dashboard', '/api/v1/operations/bookings']) {
      expect((await agent().get(path)).status, `anon ${path}`).toBe(401);
      expect((await agent().get(path).set('Cookie', cust.cookies.header)).status).toBe(403);
      expect((await agent().get(path).set('Cookie', tech.cookies.header)).status).toBe(403);
      expect((await agent().get(path).set('Cookie', opsCookies.header)).status).toBe(200);
    }
  });
});

describe('GET /api/v1/operations/dashboard', () => {
  it('reports live counts derived from booking state', async () => {
    const before = (
      await agent().get('/api/v1/operations/dashboard').set('Cookie', opsCookies.header)
    ).body.dashboard;
    expect(Object.keys(before.bookings.byStatus).sort()).toEqual(
      [
        'assigned',
        'cancelled',
        'completed',
        'confirmed',
        'in_progress',
        'pending',
        'rejected',
      ].sort(),
    );

    await bookViaApi();

    const after = (
      await agent().get('/api/v1/operations/dashboard').set('Cookie', opsCookies.header)
    ).body.dashboard;
    expect(after.bookings.total).toBe(before.bookings.total + 1);
    expect(after.bookings.byStatus.pending).toBe(before.bookings.byStatus.pending + 1);
    expect(after.bookings.active).toBe(before.bookings.active + 1);
    expect(
      after.revenue.byCurrency.find((r: { currency: string }) => r.currency === 'USD'),
    ).toBeDefined();
    expect(after.technicians.total).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/v1/operations/bookings', () => {
  it('returns a summary DTO with no sensitive fields, paginated and filterable', async () => {
    const id = await bookViaApi();

    const res = await agent()
      .get('/api/v1/operations/bookings?status=pending&limit=5')
      .set('Cookie', opsCookies.header);
    expect(res.status).toBe(200);

    const row = res.body.items.find((b: { id: string }) => b.id === id);
    expect(row).toBeDefined();
    expect(Object.keys(row).sort()).toEqual(
      [
        'createdAt',
        'currency',
        'customerName',
        'id',
        'scheduledEnd',
        'scheduledStart',
        'service',
        'status',
        'technicianName',
        'totalCents',
      ].sort(),
    );
    expect(row).not.toHaveProperty('customerEmail');
    expect(row).not.toHaveProperty('address');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/i);
    for (const b of res.body.items) expect(b.status).toBe('pending');
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 5 });
  });

  it('rejects invalid query parameters with 422', async () => {
    // `?page=1001` — M16 lowered PAGE_MAX to 1000 (deep offsets forced full sorts).
    for (const q of [
      '?limit=101',
      '?limit=0',
      '?page=0',
      '?status=nonsense',
      '?page=abc',
      '?page=1001',
    ]) {
      const res = await agent()
        .get(`/api/v1/operations/bookings${q}`)
        .set('Cookie', opsCookies.header);
      expect(res.status, q).toBe(422);
    }
    // `?page=1000` is still accepted (empty page, not an error).
    const atMax = await agent()
      .get('/api/v1/operations/bookings?page=1000')
      .set('Cookie', opsCookies.header);
    expect(atMax.status).toBe(200);
  });

  it('orders deterministically and paginates without overlap', async () => {
    await bookViaApi();
    await bookViaApi();

    const p1 = await agent()
      .get('/api/v1/operations/bookings?limit=2&page=1&sort=created_desc')
      .set('Cookie', opsCookies.header);
    const p2 = await agent()
      .get('/api/v1/operations/bookings?limit=2&page=2&sort=created_desc')
      .set('Cookie', opsCookies.header);

    const ids1 = p1.body.items.map((b: { id: string }) => b.id);
    const ids2 = p2.body.items.map((b: { id: string }) => b.id);
    expect(ids1).toHaveLength(2);
    expect(ids1.filter((x: string) => ids2.includes(x))).toEqual([]);

    const again = await agent()
      .get('/api/v1/operations/bookings?limit=2&page=1&sort=created_desc')
      .set('Cookie', opsCookies.header);
    expect(again.body.items.map((b: { id: string }) => b.id)).toEqual(ids1);
  });
});

describe('GET /api/v1/operations/bookings/:id', () => {
  it('returns the full detail DTO', async () => {
    const id = await bookViaApi();
    const res = await agent()
      .get(`/api/v1/operations/bookings/${id}`)
      .set('Cookie', opsCookies.header);

    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({
      id,
      status: 'pending',
      customerEmail: expect.stringContaining('@'),
      price: { totalCents: 10_000, currency: 'USD' },
    });
    expect(res.body.booking.address).toHaveProperty('postalCode');
    expect(res.body.booking.statusHistory[0]).toMatchObject({ from: null, to: 'pending' });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/i);
  });

  it('rejects a malformed id (422) and an unknown id (404)', async () => {
    expect(
      (await agent().get('/api/v1/operations/bookings/bad_id').set('Cookie', opsCookies.header))
        .status,
    ).toBe(422);
    expect(
      (
        await agent()
          .get('/api/v1/operations/bookings/clnonexistent000000000000')
          .set('Cookie', opsCookies.header)
      ).status,
    ).toBe(404);
  });
});

describe('PATCH /api/v1/operations/bookings/:id/status', () => {
  it('confirms a pending booking and records the operator in history', async () => {
    const id = await bookViaApi();
    const res = await opsPatch(id, { status: 'confirmed', reason: 'Verified availability' });

    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('confirmed');
    const last = res.body.booking.statusHistory.at(-1);
    expect(last).toMatchObject({
      from: 'pending',
      to: 'confirmed',
      by: opsUserName,
      byRole: 'operations',
      reason: 'Verified availability',
    });
  });

  it('rejects a pending booking', async () => {
    const id = await bookViaApi();
    expect((await opsPatch(id, { status: 'rejected' })).body.booking.status).toBe('rejected');
  });

  it('cancels a confirmed booking', async () => {
    const id = await bookViaApi();
    await opsPatch(id, { status: 'confirmed' });
    const res = await opsPatch(id, { status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('cancelled');
  });

  it('refuses transitions the state machine does not allow (409)', async () => {
    const id = await bookViaApi();
    // pending -> cancelled is not an operations transition
    expect((await opsPatch(id, { status: 'cancelled' })).status).toBe(409);
    // confirm, then confirm again
    await opsPatch(id, { status: 'confirmed' });
    expect((await opsPatch(id, { status: 'confirmed' })).status).toBe(409);
  });

  it('refuses a status an operator may not set, and mass-assignment fields (422)', async () => {
    const id = await bookViaApi();
    for (const body of [
      { status: 'assigned' },
      { status: 'in_progress' },
      { status: 'pending' },
      { status: 'confirmed', technicianId: technicianId },
      { status: 'confirmed', priceTotalCents: 1 },
      { status: 'confirmed', changedByUserId: 'x' },
    ]) {
      expect((await opsPatch(id, body)).status, JSON.stringify(body)).toBe(422);
    }
  });

  it('requires a CSRF token', async () => {
    const id = await bookViaApi();
    const res = await agent()
      .patch(`/api/v1/operations/bookings/${id}/status`)
      .set('Cookie', opsCookies.header)
      .set('X-Forwarded-For', freshIp())
      .send({ status: 'confirmed' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_ERROR');
  });

  it('lets exactly one of two concurrent identical transitions win', async () => {
    const id = await bookViaApi();
    const [a, b] = await Promise.all([
      opsPatch(id, { status: 'confirmed' }),
      opsPatch(id, { status: 'confirmed' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const events = await prisma.bookingStatusHistory.count({
      where: { bookingId: id, toStatus: 'confirmed' },
    });
    expect(events).toBe(1);
  });
});
