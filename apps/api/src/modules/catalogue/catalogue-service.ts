import { repositories, type CatalogueCategoryRow, type CatalogueServiceRow } from '@aisbp/database';
import { pageOffset, paginationMeta } from '@aisbp/shared';
import {
  catalogueCategorySchema,
  catalogueServiceListSchema,
  catalogueServiceSchema,
  type CatalogueCategory,
  type CatalogueQuery,
  type CatalogueService,
  type CatalogueServiceList,
} from '@aisbp/shared';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { cache, cacheKey } from '../../lib/cache.js';
import { AppError } from '../../lib/errors.js';

/**
 * The public catalogue is the only data cached in Milestone 13: it is public
 * (no per-user scope), read-heavy (the catalogue is the site's landing page),
 * and stable (categories, services, and prices change only through a migration
 * or the seed — there is no runtime write path). Invalidation is therefore
 * TTL-only (`CATALOGUE_CACHE_TTL_SECONDS`, default 120s); `invalidate()` exists
 * for a future service-admin milestone to call precisely.
 *
 * Free-text search (`?q=`) bypasses the cache — its key space is unbounded and
 * search results are not hot. Everything else is cached under a key built from
 * the already-validated query allow-list.
 */

const TTL = env.CATALOGUE_CACHE_TTL_SECONDS;
const NS = 'catalogue';
const categoryListDecoder = z.array(catalogueCategorySchema);

/** Cache a slug lookup only when the slug is a normal catalogue slug. */
function isCacheableSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

function toCategory(row: CatalogueCategoryRow): CatalogueCategory {
  return { id: row.id, slug: row.slug, name: row.name, description: row.description };
}

function toService(row: CatalogueServiceRow): CatalogueService {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    priceCents: row.basePriceCents,
    currency: row.currency,
    durationMinutes: row.estimatedDurationMinutes,
    category: { id: row.category.id, slug: row.category.slug, name: row.category.name },
  };
}

async function loadCategories(): Promise<CatalogueCategory[]> {
  const rows = await repositories.catalog.listActiveCategories();
  return rows.map(toCategory);
}

async function loadServices(query: CatalogueQuery): Promise<CatalogueServiceList> {
  const { items, total } = await repositories.catalog.searchActiveServices({
    q: query.q,
    categorySlug: query.category,
    sort: query.sort,
    skip: pageOffset(query.page, query.limit),
    take: query.limit,
  });
  return {
    items: items.map(toService),
    pagination: paginationMeta(query.page, query.limit, total),
  };
}

async function loadServiceBySlug(slug: string): Promise<CatalogueService> {
  const row = await repositories.catalog.findActiveServiceBySlug(slug);
  if (!row) {
    throw new AppError('NOT_FOUND', 'Service not found');
  }
  return toService(row);
}

export const catalogueService = {
  async listCategories(): Promise<CatalogueCategory[]> {
    return cache.getOrSet(
      cacheKey(NS, 'categories'),
      TTL,
      (data) => categoryListDecoder.parse(data),
      loadCategories,
    );
  },

  async listServices(query: CatalogueQuery): Promise<CatalogueServiceList> {
    // Free-text search is not cached (unbounded key space, not a hot path).
    if (query.q !== undefined) {
      return loadServices(query);
    }
    const key = cacheKey(
      NS,
      'services',
      `cat=${query.category ?? '_'}`,
      `sort=${query.sort}`,
      `page=${query.page}`,
      `limit=${query.limit}`,
    );
    return cache.getOrSet(
      key,
      TTL,
      (data) => catalogueServiceListSchema.parse(data),
      () => loadServices(query),
    );
  },

  async getServiceBySlug(slug: string): Promise<CatalogueService> {
    if (!isCacheableSlug(slug)) {
      return loadServiceBySlug(slug);
    }
    return cache.getOrSet(
      cacheKey(NS, 'service', slug),
      TTL,
      (data) => catalogueServiceSchema.parse(data),
      () => loadServiceBySlug(slug),
    );
  },

  /** Drop every catalogue cache entry. Not wired to a write path yet — there is
   * no runtime mutation of categories/services/prices — but a future
   * service-admin endpoint should call this after a write. */
  async invalidate(): Promise<number> {
    return cache.delByPrefix(`${cacheKey(NS)}:`);
  },
};
