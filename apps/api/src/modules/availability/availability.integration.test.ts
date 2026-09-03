import { prisma } from '@aisbp/database/testing';
import { AVAILABILITY_PUBLIC_MAX_SLOTS } from '@aisbp/shared';
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
 * Availability & scheduling integration tests. Require a migrated + seeded
 * PostgreSQL (the exclusion constraint is exercised for real) and a reachable
 * Redis for the technician session.
 */

const P = 'avtest-';
const ACTIVE_SLUG = `${P}active-service`;
const INACTIVE_SLUG = `${P}inactive-service`;

let activeServiceId = '';
let inactiveServiceId = '';

interface TestTechnician {
  technicianId: string;
  header: string;
  csrf: string;
}

async function makeTechnician(tag: string): Promise<TestTechnician> {
  const email = uniqueEmail(`tech-${tag}`);
  await registerUser(email);
  await prisma.user.update({ where: { email }, data: { role: 'technician' } });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const technician = await prisma.technician.create({
    data: {
      id: `${P}tech-${tag}-${user.id.slice(-6)}`,
      userId: user.id,
      displayName: `Tech ${tag}`,
      serviceArea: 'Test area',
    },
  });
  const cookies = await loginUser(email);
  return { technicianId: technician.id, header: cookies.header, csrf: cookies.csrfToken };
}

/** N days from now at a fixed UTC time, as an ISO string. */
function inDays(days: number, hour = 9, minute = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

function createSlot(tech: TestTechnician, body: Record<string, unknown>) {
  return agent()
    .post('/api/v1/technician/availability')
    .set('Cookie', tech.header)
    .set('X-CSRF-Token', tech.csrf)
    .set('X-Forwarded-For', freshIp())
    .send(body);
}

beforeAll(async () => {
  await resetAuthState();
  await prisma.availabilitySlot.deleteMany({ where: { service: { slug: { startsWith: P } } } });
  await prisma.service.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.serviceCategory.deleteMany({ where: { slug: { startsWith: P } } });

  const category = await prisma.serviceCategory.create({
    data: { id: `${P}cat`, name: 'Test', slug: `${P}cat`, description: 'x' },
  });
  const active = await prisma.service.create({
    data: {
      id: `${P}svc-active`,
      categoryId: category.id,
      name: 'Test Active Service',
      slug: ACTIVE_SLUG,
      description: 'x',
      basePriceCents: 1000,
      estimatedDurationMinutes: 60,
      active: true,
    },
  });
  const inactive = await prisma.service.create({
    data: {
      id: `${P}svc-inactive`,
      categoryId: category.id,
      name: 'Test Inactive Service',
      slug: INACTIVE_SLUG,
      description: 'x',
      basePriceCents: 1000,
      estimatedDurationMinutes: 60,
      active: false,
    },
  });
  activeServiceId = active.id;
  inactiveServiceId = inactive.id;
});

afterAll(async () => {
  await resetAuthState();
  await prisma.availabilitySlot.deleteMany({
    where: { serviceId: { in: [activeServiceId, inactiveServiceId] } },
  });
  await prisma.service.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.serviceCategory.deleteMany({ where: { slug: { startsWith: P } } });
  await closeConnections();
});

describe('GET /api/v1/services/:slug/availability (public)', () => {
  it('returns future, chronologically ordered slots for an active service and leaks nothing', async () => {
    const tech = await makeTechnician('pub');
    await prisma.availabilitySlot.createMany({
      data: [
        {
          technicianId: tech.technicianId,
          serviceId: activeServiceId,
          startsAt: new Date(inDays(5, 13)),
          endsAt: new Date(inDays(5, 14)),
        },
        {
          technicianId: tech.technicianId,
          serviceId: activeServiceId,
          startsAt: new Date(inDays(3, 9)),
          endsAt: new Date(inDays(3, 10)),
        },
        {
          technicianId: tech.technicianId,
          serviceId: activeServiceId,
          startsAt: new Date(inDays(-2, 9)), // past
          endsAt: new Date(inDays(-2, 10)),
        },
      ],
    });

    const res = await agent().get(`/api/v1/services/${ACTIVE_SLUG}/availability`);
    expect(res.status).toBe(200);

    const starts = res.body.items.map((s: { startsAt: string }) => s.startsAt);
    expect(starts).toEqual([...starts].sort());
    expect(starts.length).toBe(2); // past one excluded
    expect(new Date(starts[0]).getTime()).toBeGreaterThan(Date.now());

    for (const slot of res.body.items) {
      expect(Object.keys(slot).sort()).toEqual(['durationMinutes', 'endsAt', 'id', 'startsAt']);
    }
    const serialised = JSON.stringify(res.body);
    for (const leak of ['technicianId', 'serviceId', 'userId', 'email', '"status"', 'createdAt']) {
      expect(serialised).not.toContain(leak);
    }
    expect(res.body.window).toMatchObject({ from: expect.any(String), to: expect.any(String) });
  });

  it('returns 404 for an inactive service (no availability exposed)', async () => {
    const tech = await makeTechnician('inact');
    await prisma.availabilitySlot.create({
      data: {
        technicianId: tech.technicianId,
        serviceId: inactiveServiceId,
        startsAt: new Date(inDays(4)),
        endsAt: new Date(inDays(4, 10)),
      },
    });
    const res = await agent().get(`/api/v1/services/${INACTIVE_SLUG}/availability`);
    expect(res.status).toBe(404);
  });

  it('rejects an invalid time range (to before from) with 422', async () => {
    const res = await agent().get(
      `/api/v1/services/${ACTIVE_SLUG}/availability?from=${inDays(10)}&to=${inDays(2)}`,
    );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an excessive time window with 422', async () => {
    const res = await agent().get(
      `/api/v1/services/${ACTIVE_SLUG}/availability?from=${inDays(1)}&to=${inDays(400)}`,
    );
    expect(res.status).toBe(422);
  });

  it('rejects a malformed timestamp with 422', async () => {
    const res = await agent().get(`/api/v1/services/${ACTIVE_SLUG}/availability?from=next-week`);
    expect(res.status).toBe(422);
  });

  // M16: the public response is capped regardless of how many slots exist.
  it('caps the public response at AVAILABILITY_PUBLIC_MAX_SLOTS', async () => {
    const tech = await makeTechnician('cap');
    const base = new Date();
    base.setUTCDate(base.getUTCDate() + 2);
    base.setUTCHours(0, 0, 0, 0);
    const overCap = AVAILABILITY_PUBLIC_MAX_SLOTS + 10;
    await prisma.availabilitySlot.createMany({
      data: Array.from({ length: overCap }, (_, i) => ({
        technicianId: tech.technicianId,
        serviceId: activeServiceId,
        startsAt: new Date(base.getTime() + i * 30 * 60_000),
        endsAt: new Date(base.getTime() + i * 30 * 60_000 + 15 * 60_000),
      })),
    });

    const res = await agent().get(
      `/api/v1/services/${ACTIVE_SLUG}/availability?from=${base.toISOString()}&to=${new Date(base.getTime() + 60 * 86_400_000).toISOString()}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(AVAILABILITY_PUBLIC_MAX_SLOTS);
  });
});

describe('technician availability management', () => {
  it('lets a technician create, list, update and delete their own slots', async () => {
    const tech = await makeTechnician('crud');

    const created = await createSlot(tech, {
      serviceSlug: ACTIVE_SLUG,
      startsAt: inDays(6, 9),
      endsAt: inDays(6, 11),
    });
    expect(created.status).toBe(201);
    expect(created.body.slot).toMatchObject({
      service: { slug: ACTIVE_SLUG },
      durationMinutes: 120,
      status: 'available',
      booked: false,
    });
    expect(created.body.slot).not.toHaveProperty('technicianId');
    const id = created.body.slot.id;

    const list = await agent().get('/api/v1/technician/availability').set('Cookie', tech.header);
    expect(list.status).toBe(200);
    expect(list.body.items.map((s: { id: string }) => s.id)).toContain(id);

    const updated = await agent()
      .patch(`/api/v1/technician/availability/${id}`)
      .set('Cookie', tech.header)
      .set('X-CSRF-Token', tech.csrf)
      .send({ endsAt: inDays(6, 10) });
    expect(updated.status).toBe(200);
    expect(updated.body.slot.durationMinutes).toBe(60);

    const removed = await agent()
      .delete(`/api/v1/technician/availability/${id}`)
      .set('Cookie', tech.header)
      .set('X-CSRF-Token', tech.csrf);
    expect(removed.status).toBe(204);

    const after = await agent().get('/api/v1/technician/availability').set('Cookie', tech.header);
    expect(after.body.items.map((s: { id: string }) => s.id)).not.toContain(id);
  });

  it('rejects a slot shorter than the minimum length with 422 (M16)', async () => {
    const tech = await makeTechnician('tiny');
    const res = await createSlot(tech, {
      serviceSlug: ACTIVE_SLUG,
      startsAt: inDays(6, 9, 0),
      endsAt: inDays(6, 9, 10), // 10 minutes
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it("never lets a technician touch another technician's slot (404, not 403)", async () => {
    const owner = await makeTechnician('owner');
    const other = await makeTechnician('other');
    const created = await createSlot(owner, {
      serviceSlug: ACTIVE_SLUG,
      startsAt: inDays(7, 9),
      endsAt: inDays(7, 10),
    });
    const id = created.body.slot.id;

    const patch = await agent()
      .patch(`/api/v1/technician/availability/${id}`)
      .set('Cookie', other.header)
      .set('X-CSRF-Token', other.csrf)
      .send({ endsAt: inDays(7, 12) });
    expect(patch.status).toBe(404);

    const del = await agent()
      .delete(`/api/v1/technician/availability/${id}`)
      .set('Cookie', other.header)
      .set('X-CSRF-Token', other.csrf);
    expect(del.status).toBe(404);

    const still = await agent().get('/api/v1/technician/availability').set('Cookie', owner.header);
    expect(still.body.items.map((s: { id: string }) => s.id)).toContain(id);
  });

  it('forbids customers and unauthenticated users, and requires CSRF for mutations', async () => {
    const tech = await makeTechnician('guard');

    const { email } = await registerUser();
    const customer = await loginUser(email);
    expect(
      (await agent().get('/api/v1/technician/availability').set('Cookie', customer.header)).status,
    ).toBe(403);

    expect((await agent().get('/api/v1/technician/availability')).status).toBe(401);

    const noCsrf = await agent()
      .post('/api/v1/technician/availability')
      .set('Cookie', tech.header)
      .send({ serviceSlug: ACTIVE_SLUG, startsAt: inDays(8, 9), endsAt: inDays(8, 10) });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe('CSRF_ERROR');
  });

  it('rejects overlapping slots and accepts adjacent ones', async () => {
    const tech = await makeTechnician('overlap');
    const day = 9;

    const first = await createSlot(tech, {
      serviceSlug: ACTIVE_SLUG,
      startsAt: inDays(day, 9),
      endsAt: inDays(day, 10),
    });
    expect(first.status).toBe(201);

    const adjacent = await createSlot(tech, {
      serviceSlug: ACTIVE_SLUG,
      startsAt: inDays(day, 10),
      endsAt: inDays(day, 11),
    });
    expect(adjacent.status).toBe(201);

    const overlapping = await createSlot(tech, {
      serviceSlug: ACTIVE_SLUG,
      startsAt: inDays(day, 9, 30),
      endsAt: inDays(day, 10, 30),
    });
    expect(overlapping.status).toBe(409);
    expect(overlapping.body.error.code).toBe('CONFLICT');
  });

  it('keeps concurrent overlapping creates database-safe', async () => {
    const tech = await makeTechnician('race');
    const body = (offsetMinutes: number) => ({
      serviceSlug: ACTIVE_SLUG,
      startsAt: inDays(11, 9, offsetMinutes),
      endsAt: inDays(11, 10, offsetMinutes),
    });

    const results = await Promise.all([
      createSlot(tech, body(0)),
      createSlot(tech, body(30)), // overlaps the first
    ]);

    const created = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 409);
    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const count = await prisma.availabilitySlot.count({
      where: { technicianId: tech.technicianId },
    });
    expect(count).toBe(1);
  });

  it('rejects zero-duration and past slots with 422', async () => {
    const tech = await makeTechnician('bad');

    const zero = await createSlot(tech, {
      serviceSlug: ACTIVE_SLUG,
      startsAt: inDays(12, 9),
      endsAt: inDays(12, 9),
    });
    expect(zero.status).toBe(422);

    const past = await createSlot(tech, {
      serviceSlug: ACTIVE_SLUG,
      startsAt: inDays(-1, 9),
      endsAt: inDays(-1, 10),
    });
    expect(past.status).toBe(422);
  });

  it('rejects a malformed slot id and unknown-but-valid id', async () => {
    const tech = await makeTechnician('ids');

    const malformed = await agent()
      .delete('/api/v1/technician/availability/not a slot')
      .set('Cookie', tech.header)
      .set('X-CSRF-Token', tech.csrf);
    expect(malformed.status).toBe(422);

    const unknown = await agent()
      .delete('/api/v1/technician/availability/ckunknown0000unknown0000zz')
      .set('Cookie', tech.header)
      .set('X-CSRF-Token', tech.csrf);
    expect(unknown.status).toBe(404);
  });

  it('rejects new availability for an inactive service', async () => {
    const tech = await makeTechnician('inactivesvc');
    const res = await createSlot(tech, {
      serviceSlug: INACTIVE_SLUG,
      startsAt: inDays(13, 9),
      endsAt: inDays(13, 10),
    });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].path).toBe('serviceSlug');
  });

  it('rejects client-supplied ownership and status fields', async () => {
    const tech = await makeTechnician('massassign');
    const res = await createSlot(tech, {
      serviceSlug: ACTIVE_SLUG,
      startsAt: inDays(14, 9),
      endsAt: inDays(14, 10),
      technicianId: 'someone-else',
      userId: 'someone-else',
      status: 'booked',
      bookingId: 'x',
    });
    expect(res.status).toBe(422);
  });
});
