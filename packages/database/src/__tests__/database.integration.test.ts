import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../client.js';
import { repositories } from '../repositories/index.js';

/**
 * Integration tests. They require a migrated and seeded PostgreSQL database
 * reachable at DATABASE_URL:
 *
 *   docker compose up -d postgres
 *   pnpm --filter @aisbp/database db:migrate:deploy
 *   pnpm --filter @aisbp/database db:seed
 *
 * Every row created here is prefixed so cleanup is exact and reruns are safe.
 */

const P = 'itest-';

async function cleanup(): Promise<void> {
  await prisma.bookingStatusHistory.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.booking.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.availabilitySlot.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.technician.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.service.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.serviceCategory.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.address.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

beforeAll(async () => {
  await prisma.$connect();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('seed data through the repository layer', () => {
  it('returns only active services and hides inactive ones', async () => {
    const services = await repositories.catalog.listActiveServices();

    expect(services.length).toBeGreaterThan(0);
    expect(services.every((service) => service.active)).toBe(true);
    expect(services.map((service) => service.slug)).toContain('washing-machine-installation');
    expect(services.map((service) => service.slug)).not.toContain('legacy-tv-wall-mount');
  });

  it('returns seeded categories', async () => {
    const categories = await repositories.catalog.listActiveCategories();
    expect(categories.map((category) => category.slug)).toContain('appliance-installation');
  });

  it('looks a service up by slug', async () => {
    const service = await repositories.catalog.findServiceBySlug('wifi-mesh-setup');
    expect(service?.name).toBe('Wi-Fi Mesh Setup');
  });
});

describe('unique constraints', () => {
  it('rejects a duplicate user email', async () => {
    await prisma.user.create({
      data: {
        id: `${P}email-a`,
        email: `${P}dup@example.com`,
        name: 'A',
        passwordHash: 'x',
        role: 'customer',
      },
    });

    await expect(
      prisma.user.create({
        data: {
          id: `${P}email-b`,
          email: `${P}dup@example.com`,
          name: 'B',
          passwordHash: 'x',
          role: 'customer',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a duplicate service slug', async () => {
    const category = await prisma.serviceCategory.create({
      data: { id: `${P}slug-cat`, name: 'Cat', slug: `${P}slug-cat`, description: 'x' },
    });
    await prisma.service.create({
      data: {
        id: `${P}slug-a`,
        categoryId: category.id,
        name: 'A',
        slug: `${P}dup-slug`,
        description: 'x',
        basePriceCents: 1000,
        estimatedDurationMinutes: 30,
      },
    });

    await expect(
      prisma.service.create({
        data: {
          id: `${P}slug-b`,
          categoryId: category.id,
          name: 'B',
          slug: `${P}dup-slug`,
          description: 'x',
          basePriceCents: 2000,
          estimatedDurationMinutes: 30,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a second technician profile for the same user', async () => {
    const user = await prisma.user.create({
      data: {
        id: `${P}tech-user`,
        email: `${P}tech-user@example.com`,
        name: 'T',
        passwordHash: 'x',
        role: 'technician',
      },
    });
    await prisma.technician.create({
      data: { id: `${P}tech-a`, userId: user.id, displayName: 'T', serviceArea: 'A' },
    });

    await expect(
      prisma.technician.create({
        data: { id: `${P}tech-b`, userId: user.id, displayName: 'T2', serviceArea: 'B' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('availability slot constraints', () => {
  async function makeTechnicianAndService(tag: string): Promise<{
    technicianId: string;
    serviceId: string;
  }> {
    const user = await prisma.user.create({
      data: {
        id: `${P}${tag}-u`,
        email: `${P}${tag}@example.com`,
        name: 'T',
        passwordHash: 'x',
        role: 'technician',
      },
    });
    const technician = await prisma.technician.create({
      data: { id: `${P}${tag}-tech`, userId: user.id, displayName: 'T', serviceArea: 'A' },
    });
    const category = await prisma.serviceCategory.create({
      data: { id: `${P}${tag}-cat`, name: 'C', slug: `${P}${tag}-cat`, description: 'x' },
    });
    const service = await prisma.service.create({
      data: {
        id: `${P}${tag}-svc`,
        categoryId: category.id,
        name: 'S',
        slug: `${P}${tag}-svc`,
        description: 'x',
        basePriceCents: 5000,
        estimatedDurationMinutes: 60,
      },
    });
    return { technicianId: technician.id, serviceId: service.id };
  }

  it('rejects overlapping slots for the same technician', async () => {
    const { technicianId, serviceId } = await makeTechnicianAndService('overlap');

    await prisma.availabilitySlot.create({
      data: {
        id: `${P}overlap-1`,
        technicianId,
        serviceId,
        startsAt: new Date('2999-02-01T09:00:00.000Z'),
        endsAt: new Date('2999-02-01T11:00:00.000Z'),
      },
    });

    await expect(
      prisma.availabilitySlot.create({
        data: {
          id: `${P}overlap-2`,
          technicianId,
          serviceId,
          startsAt: new Date('2999-02-01T10:00:00.000Z'),
          endsAt: new Date('2999-02-01T12:00:00.000Z'),
        },
      }),
    ).rejects.toThrow();

    const count = await prisma.availabilitySlot.count({ where: { technicianId } });
    expect(count).toBe(1);
  });

  it('allows back-to-back slots for the same technician', async () => {
    const { technicianId, serviceId } = await makeTechnicianAndService('adjacent');

    await prisma.availabilitySlot.create({
      data: {
        id: `${P}adjacent-1`,
        technicianId,
        serviceId,
        startsAt: new Date('2999-02-02T09:00:00.000Z'),
        endsAt: new Date('2999-02-02T11:00:00.000Z'),
      },
    });
    await prisma.availabilitySlot.create({
      data: {
        id: `${P}adjacent-2`,
        technicianId,
        serviceId,
        startsAt: new Date('2999-02-02T11:00:00.000Z'),
        endsAt: new Date('2999-02-02T13:00:00.000Z'),
      },
    });

    const count = await prisma.availabilitySlot.count({ where: { technicianId } });
    expect(count).toBe(2);
  });

  it('rejects a slot that ends before it starts', async () => {
    const { technicianId, serviceId } = await makeTechnicianAndService('reversed');

    await expect(
      prisma.availabilitySlot.create({
        data: {
          id: `${P}reversed-1`,
          technicianId,
          serviceId,
          startsAt: new Date('2999-03-01T11:00:00.000Z'),
          endsAt: new Date('2999-03-01T09:00:00.000Z'),
        },
      }),
    ).rejects.toThrow();
  });
});

describe('booking price snapshot', () => {
  it('does not change when the service is repriced', async () => {
    const customer = await prisma.user.create({
      data: {
        id: `${P}snap-cust`,
        email: `${P}snap-cust@example.com`,
        name: 'C',
        passwordHash: 'x',
        role: 'customer',
      },
    });
    const technicianUser = await prisma.user.create({
      data: {
        id: `${P}snap-tech-u`,
        email: `${P}snap-tech@example.com`,
        name: 'T',
        passwordHash: 'x',
        role: 'technician',
      },
    });
    const address = await prisma.address.create({
      data: {
        id: `${P}snap-addr`,
        userId: customer.id,
        label: 'Home',
        line1: '1 Test St',
        city: 'Town',
        state: 'ST',
        postalCode: '00000',
        country: 'US',
      },
    });
    const category = await prisma.serviceCategory.create({
      data: { id: `${P}snap-cat`, name: 'Cat', slug: `${P}snap-cat`, description: 'x' },
    });
    const service = await prisma.service.create({
      data: {
        id: `${P}snap-svc`,
        categoryId: category.id,
        name: 'Snapshot Service',
        slug: `${P}snap-svc`,
        description: 'x',
        basePriceCents: 10_000,
        currency: 'USD',
        estimatedDurationMinutes: 60,
      },
    });
    const technician = await prisma.technician.create({
      data: { id: `${P}snap-tech`, userId: technicianUser.id, displayName: 'T', serviceArea: 'A' },
    });
    const scheduledStart = new Date('2999-01-01T09:00:00.000Z');
    const scheduledEnd = new Date('2999-01-01T10:00:00.000Z');
    const slot = await prisma.availabilitySlot.create({
      data: {
        id: `${P}snap-slot`,
        technicianId: technician.id,
        serviceId: service.id,
        startsAt: scheduledStart,
        endsAt: scheduledEnd,
        status: 'booked',
      },
    });

    const booking = await prisma.booking.create({
      data: {
        id: `${P}snap-booking`,
        customerId: customer.id,
        addressId: address.id,
        serviceId: service.id,
        technicianId: technician.id,
        slotId: slot.id,
        status: 'confirmed',
        scheduledStart,
        scheduledEnd,
        priceCurrency: service.currency,
        priceSubtotalCents: service.basePriceCents,
        priceTaxTotalCents: 0,
        priceFeesTotalCents: 0,
        priceDiscountTotalCents: 0,
        priceTotalCents: service.basePriceCents,
        priceBreakdown: {
          lines: [{ label: service.name, amountCents: service.basePriceCents }],
        },
      },
    });

    // Reprice the service after the booking exists.
    await prisma.service.update({
      where: { id: service.id },
      data: { basePriceCents: 25_000 },
    });

    const reloaded = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    const currentService = await prisma.service.findUniqueOrThrow({ where: { id: service.id } });

    expect(currentService.basePriceCents).toBe(25_000);
    expect(reloaded.priceSubtotalCents).toBe(10_000);
    expect(reloaded.priceTotalCents).toBe(10_000);
    expect(reloaded.priceCurrency).toBe('USD');
  });

  it('enforces price-total consistency at the database', async () => {
    const customer = await prisma.user.create({
      data: {
        id: `${P}bad-price-cust`,
        email: `${P}bad-price@example.com`,
        name: 'C',
        passwordHash: 'x',
        role: 'customer',
      },
    });
    const address = await prisma.address.create({
      data: {
        id: `${P}bad-price-addr`,
        userId: customer.id,
        label: 'Home',
        line1: '1 Test St',
        city: 'Town',
        state: 'ST',
        postalCode: '00000',
        country: 'US',
      },
    });
    const category = await prisma.serviceCategory.create({
      data: { id: `${P}bad-price-cat`, name: 'Cat', slug: `${P}bad-price-cat`, description: 'x' },
    });
    const service = await prisma.service.create({
      data: {
        id: `${P}bad-price-svc`,
        categoryId: category.id,
        name: 'S',
        slug: `${P}bad-price-svc`,
        description: 'x',
        basePriceCents: 10_000,
        estimatedDurationMinutes: 60,
      },
    });
    const technicianUser = await prisma.user.create({
      data: {
        id: `${P}bad-price-techu`,
        email: `${P}bad-price-tech@example.com`,
        name: 'T',
        passwordHash: 'x',
        role: 'technician',
      },
    });
    const technician = await prisma.technician.create({
      data: {
        id: `${P}bad-price-tech`,
        userId: technicianUser.id,
        displayName: 'T',
        serviceArea: 'A',
      },
    });
    const scheduledStart = new Date('2999-04-01T09:00:00.000Z');
    const scheduledEnd = new Date('2999-04-01T10:00:00.000Z');
    const slot = await prisma.availabilitySlot.create({
      data: {
        id: `${P}bad-price-slot`,
        technicianId: technician.id,
        serviceId: service.id,
        startsAt: scheduledStart,
        endsAt: scheduledEnd,
      },
    });

    await expect(
      prisma.booking.create({
        data: {
          id: `${P}bad-price-booking`,
          customerId: customer.id,
          addressId: address.id,
          serviceId: service.id,
          slotId: slot.id,
          status: 'pending',
          scheduledStart,
          scheduledEnd,
          priceCurrency: 'USD',
          priceSubtotalCents: 10_000,
          priceFeesTotalCents: 0,
          priceDiscountTotalCents: 0,
          priceTaxTotalCents: 0,
          priceTotalCents: 999, // inconsistent on purpose
          priceBreakdown: {},
        },
      }),
    ).rejects.toThrow();
  });
});
