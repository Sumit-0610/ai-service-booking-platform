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
 * Technician management & assignment integration tests (Milestone 11). Require a
 * migrated + seeded PostgreSQL and a reachable Redis. Bookings for assignment
 * tests are created through the real customer booking API and then moved to
 * `confirmed` directly.
 */

const P = 'm11-';
const SVC_A = `${P}svc-a`;
const SVC_B = `${P}svc-b`;
const SVC_INACTIVE = `${P}svc-inactive`;

let serviceA = '';
let serviceB = '';
let serviceInactive = '';
let opsCookies: AuthCookies;
let opsUserId = '';
let customer: { cookies: AuthCookies; addressId: string };

interface Tech {
  id: string;
  userId: string;
  cookies: AuthCookies;
}
let techA: Tech; // active, qualified for A
let techB: Tech; // active, qualified for A + B
let techC: Tech; // inactive, qualified for A
let techD: Tech; // active, qualified for A — used as an initial slot owner

async function makeUser(role: 'operations' | 'customer' | 'technician', tag: string) {
  const email = uniqueEmail(`${role}-${tag}`);
  await registerUser(email);
  if (role !== 'customer') {
    await prisma.user.update({ where: { email }, data: { role } });
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const cookies = await loginUser(email);
  return { email, userId: user.id, cookies };
}

async function makeTech(tag: string, active: boolean, serviceIds: string[]): Promise<Tech> {
  const u = await makeUser('technician', tag);
  const technician = await prisma.technician.create({
    data: {
      id: `${P}tech-${tag}`,
      userId: u.userId,
      displayName: `Tech ${tag.toUpperCase()}`,
      serviceArea: 'Test area',
      active,
    },
  });
  for (const serviceId of serviceIds) {
    await prisma.technicianService.create({ data: { technicianId: technician.id, serviceId } });
  }
  return { id: technician.id, userId: u.userId, cookies: u.cookies };
}

let slotSeq = 0;
async function bookConfirmed(serviceId: string, slotTechnicianId: string): Promise<string> {
  slotSeq += 1;
  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + 2 + slotSeq);
  startsAt.setUTCHours(9, 0, 0, 0);
  const endsAt = new Date(startsAt);
  endsAt.setUTCHours(10, 0, 0, 0);
  await prisma.availabilitySlot.create({
    data: {
      id: `${P}slot-${slotSeq}`,
      technicianId: slotTechnicianId,
      serviceId,
      startsAt,
      endsAt,
      status: 'available',
    },
  });
  const created = await agent()
    .post('/api/v1/bookings')
    .set('Cookie', customer.cookies.header)
    .set('X-CSRF-Token', customer.cookies.csrfToken)
    .set('X-Forwarded-For', freshIp())
    .send({ slotId: `${P}slot-${slotSeq}`, addressId: customer.addressId });
  expect(created.status).toBe(201);
  const id = created.body.booking.id;
  await prisma.booking.update({ where: { id }, data: { status: 'confirmed' } });
  await prisma.bookingStatusHistory.create({
    data: {
      bookingId: id,
      fromStatus: 'pending',
      toStatus: 'confirmed',
      changedByUserId: opsUserId,
    },
  });
  return id;
}

function opsPost(path: string, body?: Record<string, unknown>) {
  const r = agent()
    .post(path)
    .set('Cookie', opsCookies.header)
    .set('X-CSRF-Token', opsCookies.csrfToken)
    .set('X-Forwarded-For', freshIp());
  return body === undefined ? r : r.send(body);
}
function opsPatch(path: string, body?: Record<string, unknown>) {
  const r = agent()
    .patch(path)
    .set('Cookie', opsCookies.header)
    .set('X-CSRF-Token', opsCookies.csrfToken)
    .set('X-Forwarded-For', freshIp());
  return body === undefined ? r : r.send(body);
}
function opsDelete(path: string) {
  return agent()
    .delete(path)
    .set('Cookie', opsCookies.header)
    .set('X-CSRF-Token', opsCookies.csrfToken)
    .set('X-Forwarded-For', freshIp());
}
function techPatch(cookies: AuthCookies, path: string, body?: Record<string, unknown>) {
  const r = agent()
    .patch(path)
    .set('Cookie', cookies.header)
    .set('X-CSRF-Token', cookies.csrfToken)
    .set('X-Forwarded-For', freshIp());
  return body === undefined ? r : r.send(body);
}

async function cleanup(): Promise<void> {
  await prisma.booking.deleteMany({ where: { slot: { id: { startsWith: P } } } });
  await prisma.availabilitySlot.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.technicianService.deleteMany({ where: { serviceId: { startsWith: P } } });
}

beforeAll(async () => {
  await resetAuthState();
  await cleanup();
  await prisma.technician.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.service.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.serviceCategory.deleteMany({ where: { slug: { startsWith: P } } });

  const category = await prisma.serviceCategory.create({
    data: { id: `${P}cat0`, name: 'M11 test', slug: `${P}cat`, description: 'x' },
  });
  const mk = (slug: string, active: boolean) =>
    prisma.service.create({
      data: {
        id: `${P}${slug.split('-').pop()}svc`,
        categoryId: category.id,
        name: `M11 ${slug}`,
        slug,
        description: 'x',
        basePriceCents: 10_000,
        currency: 'USD',
        estimatedDurationMinutes: 60,
        active,
      },
    });
  serviceA = (await mk(SVC_A, true)).id;
  serviceB = (await mk(SVC_B, true)).id;
  serviceInactive = (await mk(SVC_INACTIVE, false)).id;

  const ops = await makeUser('operations', 'a');
  opsCookies = ops.cookies;
  opsUserId = ops.userId;

  techA = await makeTech('a', true, [serviceA]);
  techB = await makeTech('b', true, [serviceA, serviceB]);
  techC = await makeTech('c', false, [serviceA]);
  techD = await makeTech('d', true, [serviceA]);

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
  await prisma.technician.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.service.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.serviceCategory.deleteMany({ where: { slug: { startsWith: P } } });
  await closeConnections();
});

// ---------------------------------------------------------------------------

describe('operations technician management authorization', () => {
  it('enforces the operations role', async () => {
    const anon = agent();
    for (const path of [
      '/api/v1/operations/technicians',
      `/api/v1/operations/technicians/${techA.id}`,
    ]) {
      expect((await anon.get(path)).status).toBe(401);
      expect((await agent().get(path).set('Cookie', customer.cookies.header)).status).toBe(403);
      expect((await agent().get(path).set('Cookie', techA.cookies.header)).status).toBe(403);
      expect((await agent().get(path).set('Cookie', opsCookies.header)).status).toBe(200);
    }
  });
});

describe('GET /api/v1/operations/technicians', () => {
  it('lists technicians with a summary DTO and no sensitive fields', async () => {
    const res = await agent()
      .get('/api/v1/operations/technicians?limit=50')
      .set('Cookie', opsCookies.header);
    expect(res.status).toBe(200);
    const row = res.body.items.find((t: { id: string }) => t.id === techB.id);
    expect(Object.keys(row).sort()).toEqual(
      [
        'active',
        'activeAssignmentCount',
        'displayName',
        'email',
        'id',
        'name',
        'qualifiedServiceCount',
        'serviceArea',
      ].sort(),
    );
    expect(row.qualifiedServiceCount).toBe(2);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/i);
  });

  it('filters by active status and rejects bad query params', async () => {
    const inactive = await agent()
      .get('/api/v1/operations/technicians?active=false&limit=50')
      .set('Cookie', opsCookies.header);
    expect(inactive.body.items.every((t: { active: boolean }) => t.active === false)).toBe(true);
    expect(inactive.body.items.map((t: { id: string }) => t.id)).toContain(techC.id);

    for (const q of ['?limit=999', '?limit=0', '?page=0', '?sort=weird']) {
      expect(
        (await agent().get(`/api/v1/operations/technicians${q}`).set('Cookie', opsCookies.header))
          .status,
        q,
      ).toBe(422);
    }
  });

  it('sorts by name in both directions and paginates deterministically', async () => {
    const asc = await agent()
      .get('/api/v1/operations/technicians?sort=name_asc&limit=50')
      .set('Cookie', opsCookies.header);
    const desc = await agent()
      .get('/api/v1/operations/technicians?sort=name_desc&limit=50')
      .set('Cookie', opsCookies.header);
    const ascNames = asc.body.items.map((t: { displayName: string }) => t.displayName);
    expect([...ascNames].sort()).toEqual(ascNames);
    expect(desc.body.items.map((t: { displayName: string }) => t.displayName)).toEqual(
      [...ascNames].reverse(),
    );

    const p1 = await agent()
      .get('/api/v1/operations/technicians?limit=2&page=1&sort=name_asc')
      .set('Cookie', opsCookies.header);
    const p2 = await agent()
      .get('/api/v1/operations/technicians?limit=2&page=2&sort=name_asc')
      .set('Cookie', opsCookies.header);
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.pagination).toMatchObject({ page: 1, limit: 2, hasPreviousPage: false });
    const overlap = p1.body.items
      .map((t: { id: string }) => t.id)
      .filter((id: string) => p2.body.items.some((t: { id: string }) => t.id === id));
    expect(overlap).toEqual([]);
  });
});

describe('GET /api/v1/operations/technicians/:id', () => {
  it('returns detail with qualifications; 422 malformed; 404 unknown', async () => {
    const res = await agent()
      .get(`/api/v1/operations/technicians/${techB.id}`)
      .set('Cookie', opsCookies.header);
    expect(res.status).toBe(200);
    expect(res.body.technician.qualifications.map((q: { slug: string }) => q.slug).sort()).toEqual(
      [SVC_A, SVC_B].sort(),
    );
    expect(res.body.technician.qualifications[0]).toHaveProperty('active');

    expect(
      (await agent().get('/api/v1/operations/technicians/bad_id').set('Cookie', opsCookies.header))
        .status,
    ).toBe(422);
    expect(
      (
        await agent()
          .get('/api/v1/operations/technicians/clnope0000000000000000000')
          .set('Cookie', opsCookies.header)
      ).status,
    ).toBe(404);
  });
});

describe('PATCH /api/v1/operations/technicians/:id/status', () => {
  it('toggles active, rejects bad body / mass assignment / missing CSRF', async () => {
    const d = await makeTech('status-x', true, [serviceA]);

    expect(
      (await opsPatch(`/api/v1/operations/technicians/${d.id}/status`, { active: false })).body
        .technician.active,
    ).toBe(false);
    expect(
      (await opsPatch(`/api/v1/operations/technicians/${d.id}/status`, { active: true })).body
        .technician.active,
    ).toBe(true);

    expect(
      (await opsPatch(`/api/v1/operations/technicians/${d.id}/status`, { active: 'no' })).status,
    ).toBe(422);
    expect(
      (
        await opsPatch(`/api/v1/operations/technicians/${d.id}/status`, {
          active: true,
          userId: 'x',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await agent()
          .patch(`/api/v1/operations/technicians/${d.id}/status`)
          .set('Cookie', opsCookies.header)
          .set('X-Forwarded-For', freshIp())
          .send({ active: false })
      ).status,
    ).toBe(403);
  });
});

describe('technician service qualifications', () => {
  it('adds, rejects duplicate / inactive / unknown, and removes', async () => {
    const t = await makeTech('qual-x', true, [serviceA]);

    const added = await opsPost(`/api/v1/operations/technicians/${t.id}/services`, {
      serviceId: serviceB,
    });
    expect(added.status).toBe(201);
    expect(added.body.technician.qualifications).toHaveLength(2);

    expect(
      (await opsPost(`/api/v1/operations/technicians/${t.id}/services`, { serviceId: serviceB }))
        .status,
    ).toBe(409);
    expect(
      (
        await opsPost(`/api/v1/operations/technicians/${t.id}/services`, {
          serviceId: serviceInactive,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await opsPost(`/api/v1/operations/technicians/${t.id}/services`, {
          serviceId: 'clnope0000000000000000000',
        })
      ).status,
    ).toBe(422);

    const removed = await opsDelete(`/api/v1/operations/technicians/${t.id}/services/${serviceB}`);
    expect(removed.status).toBe(200);
    expect(removed.body.technician.qualifications).toHaveLength(1);

    expect(
      (await opsDelete(`/api/v1/operations/technicians/${t.id}/services/${serviceB}`)).status,
    ).toBe(404);
  });

  it('requires CSRF on qualification mutations', async () => {
    const t = await makeTech('qual-csrf', true, []);
    expect(
      (
        await agent()
          .post(`/api/v1/operations/technicians/${t.id}/services`)
          .set('Cookie', opsCookies.header)
          .set('X-Forwarded-For', freshIp())
          .send({ serviceId: serviceA })
      ).status,
    ).toBe(403);
  });

  it('removing a qualification does not corrupt an existing assigned booking', async () => {
    const t = await makeTech('qual-hist', true, [serviceB]);
    const bookingId = await bookConfirmed(serviceB, techD.id);
    expect(
      (
        await opsPost(`/api/v1/operations/bookings/${bookingId}/assign-technician`, {
          technicianId: t.id,
        })
      ).status,
    ).toBe(200);

    expect(
      (await opsDelete(`/api/v1/operations/technicians/${t.id}/services/${serviceB}`)).status,
    ).toBe(200);

    const booking = await agent()
      .get(`/api/v1/operations/bookings/${bookingId}`)
      .set('Cookie', opsCookies.header);
    expect(booking.body.booking.status).toBe('assigned');
    expect(booking.body.booking.technicianName).toBe('Tech QUAL-HIST');
  });
});

describe('POST /api/v1/operations/bookings/:id/assign-technician', () => {
  it('assigns a qualified active technician to a confirmed booking and records history', async () => {
    const bookingId = await bookConfirmed(serviceA, techD.id);
    const before = await agent()
      .get(`/api/v1/operations/bookings/${bookingId}`)
      .set('Cookie', opsCookies.header);
    const priceBefore = before.body.booking.price.totalCents;

    const res = await opsPost(`/api/v1/operations/bookings/${bookingId}/assign-technician`, {
      technicianId: techA.id,
      reason: 'Nearest available',
    });
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('assigned');
    expect(res.body.booking.technicianName).toBe('Tech A');
    expect(res.body.booking.price.totalCents).toBe(priceBefore);
    const last = res.body.booking.statusHistory.at(-1);
    expect(last).toMatchObject({ from: 'confirmed', to: 'assigned', byRole: 'operations' });
  });

  it('reassigns an already-assigned booking to another qualified technician', async () => {
    const bookingId = await bookConfirmed(serviceA, techD.id);
    await opsPost(`/api/v1/operations/bookings/${bookingId}/assign-technician`, {
      technicianId: techA.id,
    });
    const res = await opsPost(`/api/v1/operations/bookings/${bookingId}/assign-technician`, {
      technicianId: techB.id,
    });
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('assigned');
    expect(res.body.booking.technicianName).toBe('Tech B');
  });

  it('rejects inactive, unqualified, already-assigned, bad-state, and non-operations callers', async () => {
    const bookingId = await bookConfirmed(serviceB, techD.id);

    expect(
      (await agent().post(`/api/v1/operations/bookings/${bookingId}/assign-technician`)).status,
    ).toBe(401);
    expect(
      (
        await agent()
          .post(`/api/v1/operations/bookings/${bookingId}/assign-technician`)
          .set('Cookie', customer.cookies.header)
          .send({ technicianId: techB.id })
      ).status,
    ).toBe(403);
    expect(
      (
        await agent()
          .post(`/api/v1/operations/bookings/${bookingId}/assign-technician`)
          .set('Cookie', techA.cookies.header)
          .send({ technicianId: techB.id })
      ).status,
    ).toBe(403);

    // inactive technician
    expect(
      (
        await opsPost(`/api/v1/operations/bookings/${bookingId}/assign-technician`, {
          technicianId: techC.id,
        })
      ).status,
    ).toBe(422);
    // techA not qualified for service B
    expect(
      (
        await opsPost(`/api/v1/operations/bookings/${bookingId}/assign-technician`, {
          technicianId: techA.id,
        })
      ).status,
    ).toBe(422);
    // mass assignment
    expect(
      (
        await opsPost(`/api/v1/operations/bookings/${bookingId}/assign-technician`, {
          technicianId: techB.id,
          status: 'assigned',
        })
      ).status,
    ).toBe(422);
    // missing CSRF
    expect(
      (
        await agent()
          .post(`/api/v1/operations/bookings/${bookingId}/assign-technician`)
          .set('Cookie', opsCookies.header)
          .set('X-Forwarded-For', freshIp())
          .send({ technicianId: techB.id })
      ).status,
    ).toBe(403);

    // pending booking cannot be assigned
    const pending = await agent()
      .post('/api/v1/bookings')
      .set('Cookie', customer.cookies.header)
      .set('X-CSRF-Token', customer.cookies.csrfToken)
      .set('X-Forwarded-For', freshIp())
      .send({ slotId: await makeFreeSlot(serviceA), addressId: customer.addressId });
    expect(
      (
        await opsPost(`/api/v1/operations/bookings/${pending.body.booking.id}/assign-technician`, {
          technicianId: techA.id,
        })
      ).status,
    ).toBe(409);
  });

  it('refuses an overlapping schedule and a repeat of the same technician', async () => {
    const b1 = await bookConfirmed(serviceA, techD.id);
    const b2 = await bookConfirmedSameTimeAs(b1, serviceA, techB.id);

    expect(
      (
        await opsPost(`/api/v1/operations/bookings/${b1}/assign-technician`, {
          technicianId: techA.id,
        })
      ).status,
    ).toBe(200);
    // same technician again on the same booking
    expect(
      (
        await opsPost(`/api/v1/operations/bookings/${b1}/assign-technician`, {
          technicianId: techA.id,
        })
      ).status,
    ).toBe(409);
    // techA now has an overlapping commitment -> cannot take b2
    expect(
      (
        await opsPost(`/api/v1/operations/bookings/${b2}/assign-technician`, {
          technicianId: techA.id,
        })
      ).status,
    ).toBe(409);
  });

  it('two concurrent assignments leave the booking consistently assigned to one technician', async () => {
    const bookingId = await bookConfirmed(serviceA, techD.id);
    const [r1, r2] = await Promise.all([
      opsPost(`/api/v1/operations/bookings/${bookingId}/assign-technician`, {
        technicianId: techA.id,
      }),
      opsPost(`/api/v1/operations/bookings/${bookingId}/assign-technician`, {
        technicianId: techB.id,
      }),
    ]);
    // at least one applies; any failure is a clean conflict, never a 500
    expect([r1, r2].some((r) => r.status === 200)).toBe(true);
    for (const r of [r1, r2]) expect([200, 409]).toContain(r.status);

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { status: true, technicianId: true },
    });
    expect(booking.status).toBe('assigned');
    expect([techA.id, techB.id]).toContain(booking.technicianId);
  });
});

describe('GET /api/v1/operations/bookings/:id/assignable-technicians', () => {
  it('lists active qualified technicians with a conflict flag, excluding the current one', async () => {
    const bookingId = await bookConfirmed(serviceA, techD.id);
    const res = await agent()
      .get(`/api/v1/operations/bookings/${bookingId}/assignable-technicians`)
      .set('Cookie', opsCookies.header);
    expect(res.status).toBe(200);
    const ids = res.body.items.map((t: { id: string }) => t.id);
    expect(ids).toContain(techA.id);
    expect(ids).toContain(techB.id);
    expect(ids).not.toContain(techC.id); // inactive
    expect(ids).not.toContain(techD.id); // current
    expect(res.body.items[0]).toHaveProperty('hasScheduleConflict');
  });
});

// ---------------------------------------------------------------------------

describe('technician job workflow', () => {
  it('progresses a job assigned -> in_progress -> completed and records the technician', async () => {
    const bookingId = await bookConfirmed(serviceA, techD.id);
    await opsPost(`/api/v1/operations/bookings/${bookingId}/assign-technician`, {
      technicianId: techA.id,
    });

    const list = await agent()
      .get('/api/v1/technician/bookings')
      .set('Cookie', techA.cookies.header);
    expect(list.body.items.map((b: { id: string }) => b.id)).toContain(bookingId);

    const detail = await agent()
      .get(`/api/v1/technician/bookings/${bookingId}`)
      .set('Cookie', techA.cookies.header);
    expect(detail.body.booking.statusHistory.length).toBeGreaterThan(0);

    const started = await techPatch(
      techA.cookies,
      `/api/v1/technician/bookings/${bookingId}/status`,
      {
        status: 'in_progress',
      },
    );
    expect(started.status).toBe(200);
    expect(started.body.booking.status).toBe('in_progress');

    const done = await techPatch(techA.cookies, `/api/v1/technician/bookings/${bookingId}/status`, {
      status: 'completed',
    });
    expect(done.status).toBe(200);
    expect(done.body.booking.status).toBe('completed');
  });

  it('rejects cross-technician access and cross-technician status changes with 404', async () => {
    const bookingId = await bookConfirmed(serviceA, techD.id);
    await opsPost(`/api/v1/operations/bookings/${bookingId}/assign-technician`, {
      technicianId: techA.id,
    });

    expect(
      (
        await agent()
          .get(`/api/v1/technician/bookings/${bookingId}`)
          .set('Cookie', techB.cookies.header)
      ).status,
    ).toBe(404);
    expect(
      (
        await techPatch(techB.cookies, `/api/v1/technician/bookings/${bookingId}/status`, {
          status: 'in_progress',
        })
      ).status,
    ).toBe(404);
  });

  it('rejects invalid transitions, disallowed statuses, and non-technician callers', async () => {
    const bookingId = await bookConfirmed(serviceA, techD.id);
    await opsPost(`/api/v1/operations/bookings/${bookingId}/assign-technician`, {
      technicianId: techA.id,
    });

    // completed without in_progress
    expect(
      (
        await techPatch(techA.cookies, `/api/v1/technician/bookings/${bookingId}/status`, {
          status: 'completed',
        })
      ).status,
    ).toBe(409);
    // disallowed target status
    expect(
      (
        await techPatch(techA.cookies, `/api/v1/technician/bookings/${bookingId}/status`, {
          status: 'cancelled',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await techPatch(techA.cookies, `/api/v1/technician/bookings/${bookingId}/status`, {
          status: 'assigned',
        })
      ).status,
    ).toBe(422);
    // customer / operations cannot use the technician status route
    expect(
      (
        await techPatch(customer.cookies, `/api/v1/technician/bookings/${bookingId}/status`, {
          status: 'in_progress',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await techPatch(opsCookies, `/api/v1/technician/bookings/${bookingId}/status`, {
          status: 'in_progress',
        })
      ).status,
    ).toBe(403);
    // missing CSRF
    expect(
      (
        await agent()
          .patch(`/api/v1/technician/bookings/${bookingId}/status`)
          .set('Cookie', techA.cookies.header)
          .set('X-Forwarded-For', freshIp())
          .send({ status: 'in_progress' })
      ).status,
    ).toBe(403);
  });

  it('keeps the price snapshot unchanged across a job status change', async () => {
    const bookingId = await bookConfirmed(serviceA, techD.id);
    await opsPost(`/api/v1/operations/bookings/${bookingId}/assign-technician`, {
      technicianId: techA.id,
    });
    const before = await agent()
      .get(`/api/v1/operations/bookings/${bookingId}`)
      .set('Cookie', opsCookies.header);
    await techPatch(techA.cookies, `/api/v1/technician/bookings/${bookingId}/status`, {
      status: 'in_progress',
    });
    const after = await agent()
      .get(`/api/v1/operations/bookings/${bookingId}`)
      .set('Cookie', opsCookies.header);
    expect(after.body.booking.price).toEqual(before.body.booking.price);
  });

  it('serialises two concurrent identical transitions', async () => {
    const bookingId = await bookConfirmed(serviceA, techD.id);
    await opsPost(`/api/v1/operations/bookings/${bookingId}/assign-technician`, {
      technicianId: techA.id,
    });
    const [r1, r2] = await Promise.all([
      techPatch(techA.cookies, `/api/v1/technician/bookings/${bookingId}/status`, {
        status: 'in_progress',
      }),
      techPatch(techA.cookies, `/api/v1/technician/bookings/${bookingId}/status`, {
        status: 'in_progress',
      }),
    ]);
    expect([r1, r2].filter((r) => r.status === 200)).toHaveLength(1);
  });
});

describe('GET /api/v1/technician/profile', () => {
  it("returns the caller's own profile only", async () => {
    expect((await agent().get('/api/v1/technician/profile')).status).toBe(401);
    expect(
      (await agent().get('/api/v1/technician/profile').set('Cookie', customer.cookies.header))
        .status,
    ).toBe(403);
    expect(
      (await agent().get('/api/v1/technician/profile').set('Cookie', opsCookies.header)).status,
    ).toBe(403);

    const res = await agent().get('/api/v1/technician/profile').set('Cookie', techB.cookies.header);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.profile).sort()).toEqual(
      ['active', 'displayName', 'qualifications', 'serviceArea'].sort(),
    );
    expect(res.body.profile.qualifications.map((q: { slug: string }) => q.slug).sort()).toEqual(
      [SVC_A, SVC_B].sort(),
    );
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|email/i);
  });

  it('an inactive technician can still see their profile and complete assigned work', async () => {
    const t = await makeTech('inactive-work', true, [serviceA]);
    const bookingId = await bookConfirmed(serviceA, techD.id);
    await opsPost(`/api/v1/operations/bookings/${bookingId}/assign-technician`, {
      technicianId: t.id,
    });
    // deactivate after assignment
    await opsPatch(`/api/v1/operations/technicians/${t.id}/status`, { active: false });

    expect(
      (await agent().get('/api/v1/technician/profile').set('Cookie', t.cookies.header)).body.profile
        .active,
    ).toBe(false);
    expect(
      (
        await techPatch(t.cookies, `/api/v1/technician/bookings/${bookingId}/status`, {
          status: 'in_progress',
        })
      ).status,
    ).toBe(200);
  });
});

describe('GET /api/v1/technician/bookings — filter & pagination (Milestone 12)', () => {
  it('paginates, filters by status, and rejects bad params', async () => {
    const t = await makeTech('jobs-page', true, [serviceA]);
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const bookingId = await bookConfirmed(serviceA, techD.id);
      await opsPost(`/api/v1/operations/bookings/${bookingId}/assign-technician`, {
        technicianId: t.id,
      });
      ids.push(bookingId);
    }
    // move one to in_progress
    await techPatch(t.cookies, `/api/v1/technician/bookings/${ids[0]}/status`, {
      status: 'in_progress',
    });

    const p1 = await agent()
      .get('/api/v1/technician/bookings?limit=2&page=1&sort=scheduled_asc')
      .set('Cookie', t.cookies.header);
    expect(p1.status).toBe(200);
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.pagination).toEqual({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
      hasNextPage: true,
      hasPreviousPage: false,
    });

    const assignedOnly = await agent()
      .get('/api/v1/technician/bookings?status=assigned')
      .set('Cookie', t.cookies.header);
    expect(assignedOnly.body.items.every((b: { status: string }) => b.status === 'assigned')).toBe(
      true,
    );
    expect(assignedOnly.body.pagination.total).toBe(2);

    for (const q of ['?limit=0', '?limit=51', '?page=abc', '?status=nope', '?sort=nope']) {
      expect(
        (await agent().get(`/api/v1/technician/bookings${q}`).set('Cookie', t.cookies.header))
          .status,
        q,
      ).toBe(422);
    }
  });
});

// --- extra fixture helpers used above ---

async function makeFreeSlot(serviceId: string): Promise<string> {
  slotSeq += 1;
  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + 40 + slotSeq);
  startsAt.setUTCHours(9, 0, 0, 0);
  const endsAt = new Date(startsAt);
  endsAt.setUTCHours(10, 0, 0, 0);
  await prisma.availabilitySlot.create({
    data: {
      id: `${P}slot-${slotSeq}`,
      technicianId: techD.id,
      serviceId,
      startsAt,
      endsAt,
      status: 'available',
    },
  });
  return `${P}slot-${slotSeq}`;
}

async function bookConfirmedSameTimeAs(
  otherBookingId: string,
  serviceId: string,
  slotTechnicianId: string,
): Promise<string> {
  const other = await prisma.booking.findUniqueOrThrow({
    where: { id: otherBookingId },
    select: { scheduledStart: true, scheduledEnd: true },
  });
  slotSeq += 1;
  await prisma.availabilitySlot.create({
    data: {
      id: `${P}slot-${slotSeq}`,
      technicianId: slotTechnicianId,
      serviceId,
      startsAt: other.scheduledStart,
      endsAt: other.scheduledEnd,
      status: 'available',
    },
  });
  const created = await agent()
    .post('/api/v1/bookings')
    .set('Cookie', customer.cookies.header)
    .set('X-CSRF-Token', customer.cookies.csrfToken)
    .set('X-Forwarded-For', freshIp())
    .send({ slotId: `${P}slot-${slotSeq}`, addressId: customer.addressId });
  expect(created.status).toBe(201);
  await prisma.booking.update({
    where: { id: created.body.booking.id },
    data: { status: 'confirmed' },
  });
  return created.body.booking.id;
}
