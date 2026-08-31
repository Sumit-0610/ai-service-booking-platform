import { afterAll, describe, expect, it } from 'vitest';
import { agent, closeConnections } from '../../test/helpers.js';

/**
 * Integration tests for the public catalogue. They read the deterministic seed
 * data (see packages/database/src/seed.ts) and require a migrated + seeded
 * PostgreSQL database. No auth, no Redis.
 */

afterAll(closeConnections);

const listServices = (query = '') => agent().get(`/api/v1/services${query}`);

describe('GET /api/v1/categories', () => {
  it('returns only active categories with public fields', async () => {
    const res = await agent().get('/api/v1/categories');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);

    const slugs = res.body.items.map((c: { slug: string }) => c.slug);
    expect(slugs).toContain('appliance-installation');

    for (const category of res.body.items) {
      expect(Object.keys(category).sort()).toEqual(['description', 'id', 'name', 'slug']);
    }
  });
});

describe('GET /api/v1/services', () => {
  it('returns only active services and never the inactive one', async () => {
    const res = await listServices('?limit=48');
    expect(res.status).toBe(200);

    const slugs = res.body.items.map((s: { slug: string }) => s.slug);
    expect(slugs).toContain('washing-machine-installation');
    expect(slugs).not.toContain('legacy-tv-wall-mount');
    expect(res.body.pagination.total).toBe(slugs.length);
  });

  it('exposes only public service fields', async () => {
    const res = await listServices('?limit=1');
    const service = res.body.items[0];
    expect(Object.keys(service).sort()).toEqual(
      [
        'category',
        'currency',
        'description',
        'durationMinutes',
        'id',
        'name',
        'priceCents',
        'slug',
      ].sort(),
    );
    expect(Object.keys(service.category).sort()).toEqual(['id', 'name', 'slug']);
    expect(service).not.toHaveProperty('active');
    expect(service).not.toHaveProperty('categoryId');
    expect(service).not.toHaveProperty('createdAt');
    expect(service).not.toHaveProperty('basePriceCents');
  });

  it('filters by category slug', async () => {
    const res = await listServices('?category=home-networking&limit=48');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    for (const service of res.body.items) {
      expect(service.category.slug).toBe('home-networking');
    }
  });

  it('returns an empty page for an unknown category (no error, no leak)', async () => {
    const res = await listServices('?category=does-not-exist');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it('searches name and description, case-insensitively', async () => {
    const byName = await listServices('?q=WASHING');
    expect(byName.body.items.map((s: { slug: string }) => s.slug)).toContain(
      'washing-machine-installation',
    );

    const byDescription = await listServices('?q=firmware');
    expect(byDescription.body.items.length).toBeGreaterThan(0);
    for (const service of byDescription.body.items) {
      const haystack = `${service.name} ${service.description}`.toLowerCase();
      expect(haystack).toContain('firmware');
    }
  });

  it('sorts by price ascending and descending', async () => {
    const asc = await listServices('?sort=price_asc&limit=48');
    const ascPrices = asc.body.items.map((s: { priceCents: number }) => s.priceCents);
    expect([...ascPrices].sort((a, b) => a - b)).toEqual(ascPrices);

    const desc = await listServices('?sort=price_desc&limit=48');
    const descPrices = desc.body.items.map((s: { priceCents: number }) => s.priceCents);
    expect([...descPrices].sort((a, b) => b - a)).toEqual(descPrices);
  });

  it('paginates with stable, deterministic ordering', async () => {
    const page1 = await listServices('?limit=3&page=1');
    const page2 = await listServices('?limit=3&page=2');

    expect(page1.body.items).toHaveLength(3);
    expect(page1.body.pagination).toMatchObject({
      page: 1,
      limit: 3,
      hasPreviousPage: false,
      hasNextPage: true,
    });
    expect(page2.body.pagination.hasPreviousPage).toBe(true);

    const ids1 = page1.body.items.map((s: { id: string }) => s.id);
    const ids2 = page2.body.items.map((s: { id: string }) => s.id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toEqual([]);

    // Same request twice -> identical order.
    const page1Again = await listServices('?limit=3&page=1');
    expect(page1Again.body.items.map((s: { id: string }) => s.id)).toEqual(ids1);
  });

  it('ignores unknown query parameters (no arbitrary filters)', async () => {
    const injected = await listServices('?active=false&where[id]=x&select=password&limit=48');
    expect(injected.status).toBe(200);
    const slugs = injected.body.items.map((s: { slug: string }) => s.slug);
    expect(slugs).not.toContain('legacy-tv-wall-mount');
    expect(injected.body.items.length).toBeGreaterThan(0);
  });

  it('rejects invalid query parameters with 422', async () => {
    for (const query of [
      '?sort=cheapest',
      '?page=0',
      '?page=-1',
      '?page=abc',
      '?limit=0',
      '?limit=1000',
    ]) {
      const res = await listServices(query);
      expect(res.status, query).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('GET /api/v1/services/:slug', () => {
  it('returns an active service', async () => {
    const res = await agent().get('/api/v1/services/wifi-mesh-setup');
    expect(res.status).toBe(200);
    expect(res.body.service).toMatchObject({ slug: 'wifi-mesh-setup', name: 'Wi-Fi Mesh Setup' });
    expect(res.body.service).not.toHaveProperty('active');
  });

  it('returns 404 for an unknown slug', async () => {
    const res = await agent().get('/api/v1/services/not-a-real-service');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for an inactive service', async () => {
    const res = await agent().get('/api/v1/services/legacy-tv-wall-mount');
    expect(res.status).toBe(404);
  });
});
