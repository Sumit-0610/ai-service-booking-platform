import { prisma } from '@aisbp/database/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { agent, closeConnections } from '../../test/helpers.js';
import { redis } from '../../lib/redis.js';
import { catalogueService } from './catalogue-service.js';

/**
 * Milestone 13 — the public catalogue read-through cache. Real PostgreSQL +
 * real Redis (logical DB 15). A dedicated `ctest-` category/service is used so
 * cache staleness can be forced by a direct DB write without disturbing the
 * seed data other suites rely on.
 */

const C = 'ctest-';
const CATEGORY_SLUG = `${C}category`;
const SERVICE_SLUG = `${C}service`;
const UNIQUE_WORD = 'ctestneedleword';

const listServices = (query = '') => agent().get(`/api/v1/services${query}`);
const cacheKeys = () => redis.keys('cache:*');

async function cleanup(): Promise<void> {
  await prisma.service.deleteMany({ where: { slug: { startsWith: C } } });
  await prisma.serviceCategory.deleteMany({ where: { slug: { startsWith: C } } });
}

async function resetFixtureName(): Promise<void> {
  await prisma.service.update({
    where: { slug: SERVICE_SLUG },
    data: { name: `Original ${UNIQUE_WORD}` },
  });
}

beforeAll(async () => {
  await cleanup();
  const category = await prisma.serviceCategory.create({
    data: { name: 'Cache test', slug: CATEGORY_SLUG, description: 'Fixture', active: true },
  });
  await prisma.service.create({
    data: {
      categoryId: category.id,
      name: `Original ${UNIQUE_WORD}`,
      slug: SERVICE_SLUG,
      description: 'Fixture service for cache tests',
      basePriceCents: 9_900,
      currency: 'USD',
      estimatedDurationMinutes: 60,
      active: true,
    },
  });
});

afterAll(async () => {
  await cleanup();
  await closeConnections();
});

beforeEach(async () => {
  await redis.flushdb();
  await resetFixtureName();
});

describe('catalogue cache', () => {
  it('serves the first request from PostgreSQL, then equivalent requests from Redis', async () => {
    const first = await listServices(`?category=${CATEGORY_SLUG}`);
    expect(first.status).toBe(200);
    expect(first.body.items[0].name).toBe(`Original ${UNIQUE_WORD}`);
    expect(await cacheKeys()).toContain(
      `cache:catalogue:v1:services:cat=${CATEGORY_SLUG}:sort=name_asc:page=1:limit=12`,
    );

    // Direct DB write bypasses the API — the cached list must not see it yet.
    await prisma.service.update({
      where: { slug: SERVICE_SLUG },
      data: { name: `Renamed ${UNIQUE_WORD}` },
    });
    const cached = await listServices(`?category=${CATEGORY_SLUG}`);
    expect(cached.body.items[0].name).toBe(`Original ${UNIQUE_WORD}`);

    // Dropping the entry (what a future admin write would do) makes it fresh.
    await catalogueService.invalidate();
    const fresh = await listServices(`?category=${CATEGORY_SLUG}`);
    expect(fresh.body.items[0].name).toBe(`Renamed ${UNIQUE_WORD}`);
  });

  it('uses a distinct key per pagination / sort / filter combination', async () => {
    await listServices(`?category=${CATEGORY_SLUG}&page=1`);
    await listServices(`?category=${CATEGORY_SLUG}&page=2`);
    await listServices(`?category=${CATEGORY_SLUG}&sort=price_desc`);

    const keys = (await cacheKeys()).filter((k) => k.includes(':services:'));
    expect(keys).toEqual(expect.arrayContaining([expect.stringContaining('page=1')]));
    expect(new Set(keys).size).toBe(3);
  });

  it('does not cache free-text search, so a DB change is visible immediately', async () => {
    const before = await listServices(`?q=${UNIQUE_WORD}`);
    expect(before.body.items.some((s: { slug: string }) => s.slug === SERVICE_SLUG)).toBe(true);
    expect((await cacheKeys()).filter((k) => k.includes(':services:'))).toHaveLength(0);

    await prisma.service.update({
      where: { slug: SERVICE_SLUG },
      data: { name: `Renamed ${UNIQUE_WORD}` },
    });
    const after = await listServices(`?q=${UNIQUE_WORD}`);
    expect(after.body.items.find((s: { slug: string }) => s.slug === SERVICE_SLUG).name).toBe(
      `Renamed ${UNIQUE_WORD}`,
    );
  });

  it('caches a service detail hit but never a 404', async () => {
    const ok = await agent().get(`/api/v1/services/${SERVICE_SLUG}`);
    expect(ok.status).toBe(200);
    expect(await cacheKeys()).toContain(`cache:catalogue:v1:service:${SERVICE_SLUG}`);

    const missing = await agent().get('/api/v1/services/legacy-tv-wall-mount'); // seeded inactive
    expect(missing.status).toBe(404);
    expect(await cacheKeys()).not.toContain('cache:catalogue:v1:service:legacy-tv-wall-mount');
  });

  it('stops serving a service once it is deactivated and the entry is invalidated', async () => {
    const ok = await agent().get(`/api/v1/services/${SERVICE_SLUG}`);
    expect(ok.status).toBe(200); // now cached as a 200

    await prisma.service.update({ where: { slug: SERVICE_SLUG }, data: { active: false } });

    // Within the TTL the stale 200 is still served — the accepted cache window.
    expect((await agent().get(`/api/v1/services/${SERVICE_SLUG}`)).status).toBe(200);

    // Invalidation (or TTL expiry) closes the window: the deactivated service 404s.
    await catalogueService.invalidate();
    expect((await agent().get(`/api/v1/services/${SERVICE_SLUG}`)).status).toBe(404);

    await prisma.service.update({ where: { slug: SERVICE_SLUG }, data: { active: true } });
  });

  it('returns the same DTO shape whether the response is cached or not', async () => {
    const cold = await agent().get(`/api/v1/services/${SERVICE_SLUG}`);
    const warm = await agent().get(`/api/v1/services/${SERVICE_SLUG}`);
    expect(warm.body).toEqual(cold.body);
    expect(Object.keys(warm.body.service).sort()).toEqual([
      'category',
      'currency',
      'description',
      'durationMinutes',
      'id',
      'name',
      'priceCents',
      'slug',
    ]);
  });

  it('never creates a cache key for a malformed request or a private endpoint', async () => {
    const bad = await listServices('?limit=abc');
    expect(bad.status).toBe(422);

    const privateRes = await agent().get('/api/v1/bookings');
    expect(privateRes.status).toBe(401);

    expect(await cacheKeys()).toHaveLength(0);
  });
});
