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
} from '../../test/helpers.js';

/**
 * Integration tests for customer address management. Require a migrated,
 * seeded PostgreSQL and a reachable Redis (the auth session lives there).
 */

type Role = 'customer' | 'operations' | 'technician';

const SLOT_PREFIX = 'addrtest-slot-';

interface TestUser {
  email: string;
  header: string;
  csrf: string;
}

async function makeUser(role: Role = 'customer'): Promise<TestUser> {
  const email = uniqueEmail(role);
  const registered = await registerUser(email);
  if (role !== 'customer') {
    await prisma.user.update({ where: { email }, data: { role } });
    const cookies = await loginUser(email);
    return { email, header: cookies.header, csrf: cookies.csrfToken };
  }
  return { email, header: registered.cookies.header, csrf: registered.cookies.csrfToken };
}

const VALID_BODY = {
  label: 'Home',
  line1: '12 MG Road',
  line2: 'Near the park',
  city: 'Pune',
  state: 'Maharashtra',
  postalCode: '411001',
  country: 'IN',
};

function createAddress(user: TestUser, body: Record<string, unknown> = VALID_BODY) {
  return agent()
    .post('/api/v1/addresses')
    .set('Cookie', user.header)
    .set('X-CSRF-Token', user.csrf)
    .set('X-Forwarded-For', freshIp())
    .send(body);
}

beforeAll(resetAuthState);

afterAll(async () => {
  await prisma.bookingStatusHistory.deleteMany({
    where: { booking: { customer: { email: { startsWith: 'authtest-' } } } },
  });
  await prisma.booking.deleteMany({
    where: { customer: { email: { startsWith: 'authtest-' } } },
  });
  await prisma.availabilitySlot.deleteMany({ where: { id: { startsWith: SLOT_PREFIX } } });
  await resetAuthState();
  await closeConnections();
});

describe('POST /api/v1/addresses', () => {
  it('lets an authenticated customer create an address (normalised, no userId leaked)', async () => {
    const user = await makeUser();
    const res = await createAddress(user, {
      ...VALID_BODY,
      label: '  Home  ',
      line2: '   ',
      country: 'in',
    });

    expect(res.status).toBe(201);
    expect(res.body.address).toMatchObject({
      label: 'Home',
      line2: null,
      country: 'IN',
      city: 'Pune',
    });
    expect(Object.keys(res.body.address).sort()).toEqual(
      ['city', 'country', 'id', 'label', 'line1', 'line2', 'postalCode', 'state'].sort(),
    );
    expect(res.body.address).not.toHaveProperty('userId');
  });

  it('rejects an unauthenticated create', async () => {
    const res = await agent()
      .post('/api/v1/addresses')
      .set('X-Forwarded-For', freshIp())
      .send(VALID_BODY);
    expect(res.status).toBe(401);
  });

  it('rejects a create without a CSRF token', async () => {
    const user = await makeUser();
    const res = await agent().post('/api/v1/addresses').set('Cookie', user.header).send(VALID_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_ERROR');
  });

  it('rejects invalid input with 422 and field details', async () => {
    const user = await makeUser();
    const res = await createAddress(user, { label: '', line1: 'x', country: 'india' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(
      expect.arrayContaining(['label', 'city', 'state', 'postalCode', 'country']),
    );
  });

  it('rejects unexpected fields (mass assignment)', async () => {
    const user = await makeUser();
    const other = await makeUser();
    const res = await createAddress(user, {
      ...VALID_BODY,
      userId: 'someone-else',
      id: 'forced-id',
      isDefault: true,
    });
    expect(res.status).toBe(422);

    // Nothing was written for the other user.
    const otherList = await agent().get('/api/v1/addresses').set('Cookie', other.header);
    expect(otherList.body.items).toEqual([]);
  });
});

describe('GET /api/v1/addresses', () => {
  it("lists only the caller's own addresses", async () => {
    const user = await makeUser();
    await createAddress(user, { ...VALID_BODY, label: 'Home' });
    await createAddress(user, { ...VALID_BODY, label: 'Office' });

    const res = await agent().get('/api/v1/addresses').set('Cookie', user.header);
    expect(res.status).toBe(200);
    expect(res.body.items.map((a: { label: string }) => a.label).sort()).toEqual([
      'Home',
      'Office',
    ]);
  });
});

describe('GET / PATCH / DELETE /api/v1/addresses/:id (own resource)', () => {
  it("retrieves, updates and deletes the caller's own address", async () => {
    const user = await makeUser();
    const created = (await createAddress(user)).body.address;

    const got = await agent().get(`/api/v1/addresses/${created.id}`).set('Cookie', user.header);
    expect(got.status).toBe(200);
    expect(got.body.address.id).toBe(created.id);

    const patched = await agent()
      .patch(`/api/v1/addresses/${created.id}`)
      .set('Cookie', user.header)
      .set('X-CSRF-Token', user.csrf)
      .send({ label: 'Weekend place', line2: '' });
    expect(patched.status).toBe(200);
    expect(patched.body.address).toMatchObject({ label: 'Weekend place', line2: null });
    expect(patched.body.address.city).toBe(VALID_BODY.city); // untouched

    const removed = await agent()
      .delete(`/api/v1/addresses/${created.id}`)
      .set('Cookie', user.header)
      .set('X-CSRF-Token', user.csrf);
    expect(removed.status).toBe(204);

    const afterList = await agent().get('/api/v1/addresses').set('Cookie', user.header);
    expect(afterList.body.items.map((a: { id: string }) => a.id)).not.toContain(created.id);

    const gone = await agent().get(`/api/v1/addresses/${created.id}`).set('Cookie', user.header);
    expect(gone.status).toBe(404);
  });
});

describe('cross-customer access is impossible (IDOR)', () => {
  it("returns 404 (not 403) for read / update / delete of another customer's address", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const aliceAddress = (await createAddress(alice)).body.address;

    const read = await agent()
      .get(`/api/v1/addresses/${aliceAddress.id}`)
      .set('Cookie', bob.header);
    expect(read.status).toBe(404);

    const update = await agent()
      .patch(`/api/v1/addresses/${aliceAddress.id}`)
      .set('Cookie', bob.header)
      .set('X-CSRF-Token', bob.csrf)
      .send({ label: 'hijacked' });
    expect(update.status).toBe(404);

    const del = await agent()
      .delete(`/api/v1/addresses/${aliceAddress.id}`)
      .set('Cookie', bob.header)
      .set('X-CSRF-Token', bob.csrf);
    expect(del.status).toBe(404);

    // Alice's address is untouched.
    const stillThere = await agent()
      .get(`/api/v1/addresses/${aliceAddress.id}`)
      .set('Cookie', alice.header);
    expect(stillThere.body.address.label).toBe(VALID_BODY.label);
  });
});

describe('role boundaries', () => {
  it('forbids operations and technician roles from every address endpoint', async () => {
    for (const role of ['operations', 'technician'] as const) {
      const user = await makeUser(role);
      const list = await agent().get('/api/v1/addresses').set('Cookie', user.header);
      expect(list.status, role).toBe(403);
      expect(list.body.error.code).toBe('FORBIDDEN');

      const create = await createAddress(user);
      expect(create.status, role).toBe(403);
    }
  });
});

describe('malformed identifiers', () => {
  it('rejects a malformed id with 422 and a well-formed unknown id with 404', async () => {
    const user = await makeUser();
    for (const bad of ['has%20space', 'x', 'a_b_c', 'with.dot', "quote'd"]) {
      const res = await agent().get(`/api/v1/addresses/${bad}`).set('Cookie', user.header);
      expect(res.status, bad).toBe(422);
    }
    const unknown = await agent()
      .get('/api/v1/addresses/ckunknown0000unknown0000ab')
      .set('Cookie', user.header);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('NOT_FOUND');
  });
});

describe('referential integrity with bookings', () => {
  it('refuses to delete an address referenced by a booking (409), keeping history intact', async () => {
    const user = await makeUser();
    const address = (await createAddress(user)).body.address;

    const customer = await prisma.user.findUniqueOrThrow({ where: { email: user.email } });
    const technician = await prisma.technician.findFirstOrThrow();
    const service = await prisma.service.findFirstOrThrow({ where: { active: true } });
    const slot = await prisma.availabilitySlot.create({
      data: {
        id: `${SLOT_PREFIX}${customer.id}`,
        technicianId: technician.id,
        serviceId: service.id,
        startsAt: new Date('2999-07-01T09:00:00.000Z'),
        endsAt: new Date('2999-07-01T10:00:00.000Z'),
      },
    });
    await prisma.booking.create({
      data: {
        customerId: customer.id,
        addressId: address.id,
        serviceId: service.id,
        slotId: slot.id,
        status: 'pending',
        scheduledStart: slot.startsAt,
        scheduledEnd: slot.endsAt,
        priceCurrency: 'USD',
        priceSubtotalCents: 1000,
        priceTotalCents: 1000,
        priceBreakdown: {},
      },
    });

    const res = await agent()
      .delete(`/api/v1/addresses/${address.id}`)
      .set('Cookie', user.header)
      .set('X-CSRF-Token', user.csrf);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');

    const stillThere = await agent()
      .get(`/api/v1/addresses/${address.id}`)
      .set('Cookie', user.header);
    expect(stillThere.status).toBe(200);
  });
});
