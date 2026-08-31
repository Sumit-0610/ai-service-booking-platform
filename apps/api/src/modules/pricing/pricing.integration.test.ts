import { prisma } from '@aisbp/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agent, closeConnections } from '../../test/helpers.js';

/**
 * Integration tests for the public price quote endpoint. They read the
 * deterministic seed data plus a dedicated `prtest-` service used only for the
 * "quote reflects the current price" check. Require a migrated + seeded
 * PostgreSQL. No auth, no Redis.
 */

const P = 'prtest-';
const CATEGORY_SLUG = `${P}category`;
const PRICED_SLUG = `${P}priced-service`;
const INACTIVE_SLUG = `${P}inactive-service`;

const getPrice = (slug: string) => agent().get(`/api/v1/services/${slug}/price`);

async function cleanup(): Promise<void> {
  await prisma.service.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.serviceCategory.deleteMany({ where: { slug: { startsWith: P } } });
}

beforeAll(async () => {
  await cleanup();
  const category = await prisma.serviceCategory.create({
    data: { name: 'Pricing test', slug: CATEGORY_SLUG, description: 'Fixture', active: true },
  });
  await prisma.service.create({
    data: {
      categoryId: category.id,
      name: 'Priced service',
      slug: PRICED_SLUG,
      description: 'Fixture',
      basePriceCents: 10_000,
      currency: 'USD',
      estimatedDurationMinutes: 60,
      active: true,
    },
  });
  await prisma.service.create({
    data: {
      categoryId: category.id,
      name: 'Inactive priced service',
      slug: INACTIVE_SLUG,
      description: 'Fixture',
      basePriceCents: 5_000,
      currency: 'USD',
      estimatedDurationMinutes: 60,
      active: false,
    },
  });
});

afterAll(async () => {
  await cleanup();
  await closeConnections();
});

describe('GET /api/v1/services/:slug/price', () => {
  it('returns a quote for an active service', async () => {
    const res = await getPrice(PRICED_SLUG);
    expect(res.status).toBe(200);
    expect(res.body.quote).toEqual({
      currency: 'USD',
      subtotalCents: 10_000,
      feesTotalCents: 0,
      discountTotalCents: 0,
      taxTotalCents: 0,
      totalCents: 10_000,
      breakdown: { lines: [{ label: 'Service', amountCents: 10_000 }] },
    });
  });

  it('reflects the seed price for a real catalogue service', async () => {
    const service = await prisma.service.findUniqueOrThrow({
      where: { slug: 'wifi-mesh-setup' },
      select: { basePriceCents: true, currency: true },
    });
    const res = await getPrice('wifi-mesh-setup');
    expect(res.status).toBe(200);
    expect(res.body.quote.subtotalCents).toBe(service.basePriceCents);
    expect(res.body.quote.totalCents).toBe(service.basePriceCents);
    expect(res.body.quote.currency).toBe(service.currency);
  });

  it('keeps the price-consistency invariant (matches the booking CHECK)', async () => {
    const { quote } = (await getPrice(PRICED_SLUG)).body;
    expect(quote.totalCents).toBe(
      quote.subtotalCents + quote.feesTotalCents + quote.taxTotalCents - quote.discountTotalCents,
    );
  });

  it('returns 404 for an inactive service', async () => {
    const res = await getPrice(INACTIVE_SLUG);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for an unknown but well-formed slug', async () => {
    const res = await getPrice('not-a-real-service');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 422 for a malformed slug', async () => {
    for (const slug of ['Bad_Slug', 'has%20space', 'UPPER', 'trailing-', '-leading', 'a--b']) {
      const res = await getPrice(slug);
      expect(res.status, slug).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('exposes only the public quote DTO fields', async () => {
    const { quote } = (await getPrice(PRICED_SLUG)).body;
    expect(Object.keys(quote).sort()).toEqual(
      [
        'breakdown',
        'currency',
        'discountTotalCents',
        'feesTotalCents',
        'subtotalCents',
        'taxTotalCents',
        'totalCents',
      ].sort(),
    );
    expect(quote).not.toHaveProperty('basePriceCents');
    expect(quote).not.toHaveProperty('id');
    expect(quote).not.toHaveProperty('active');
  });

  it('ignores any client-supplied monetary values', async () => {
    const res = await agent().get(`/api/v1/services/${PRICED_SLUG}/price`).query({
      subtotalCents: '1',
      feesTotalCents: '999',
      taxTotalCents: '999',
      discountTotalCents: '999',
      totalCents: '1',
      currency: 'EUR',
      basePriceCents: '1',
    });
    expect(res.status).toBe(200);
    expect(res.body.quote).toMatchObject({
      currency: 'USD',
      subtotalCents: 10_000,
      totalCents: 10_000,
      feesTotalCents: 0,
      taxTotalCents: 0,
      discountTotalCents: 0,
    });
  });

  it('a POST with a price body cannot create or influence a quote', async () => {
    const res = await agent()
      .post(`/api/v1/services/${PRICED_SLUG}/price`)
      .send({ totalCents: 1, subtotalCents: 1 });
    expect(res.status).toBe(404); // no such route/method — nothing is written
  });

  it('the quote tracks the current Service.basePriceCents, not a snapshot', async () => {
    const first = await getPrice(PRICED_SLUG);
    expect(first.body.quote.totalCents).toBe(10_000);

    await prisma.service.update({
      where: { slug: PRICED_SLUG },
      data: { basePriceCents: 25_000 },
    });

    const second = await getPrice(PRICED_SLUG);
    expect(second.body.quote.totalCents).toBe(25_000);
    expect(second.body.quote.subtotalCents).toBe(25_000);
    expect(second.body.quote.breakdown.lines).toEqual([{ label: 'Service', amountCents: 25_000 }]);

    // restore for any re-run within the same process
    await prisma.service.update({
      where: { slug: PRICED_SLUG },
      data: { basePriceCents: 10_000 },
    });
  });
});
