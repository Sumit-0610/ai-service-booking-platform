import { prisma } from '../client.js';
import { Prisma } from '../../generated/prisma/index.js';

/**
 * Read access to the public service catalogue. This is the only sanctioned way
 * for application code to reach catalogue tables; controllers and UI code must
 * not touch Prisma directly.
 *
 * Every query is scoped to `active` rows and selects only public fields — no
 * `active` flag, no timestamps, no raw foreign keys leak past this layer.
 */

const categorySelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
} satisfies Prisma.ServiceCategorySelect;

const serviceSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  basePriceCents: true,
  currency: true,
  estimatedDurationMinutes: true,
  category: { select: { id: true, slug: true, name: true } },
} satisfies Prisma.ServiceSelect;

const servicePriceSelect = {
  basePriceCents: true,
  currency: true,
} satisfies Prisma.ServiceSelect;

export type CatalogueCategoryRow = Prisma.ServiceCategoryGetPayload<{
  select: typeof categorySelect;
}>;
export type CatalogueServiceRow = Prisma.ServiceGetPayload<{ select: typeof serviceSelect }>;
export type ServicePriceRow = Prisma.ServiceGetPayload<{ select: typeof servicePriceSelect }>;

export type CatalogueSortRow = 'name_asc' | 'name_desc' | 'price_asc' | 'price_desc' | 'newest';

export interface SearchActiveServicesParams {
  q?: string | undefined;
  categorySlug?: string | undefined;
  sort: CatalogueSortRow;
  skip: number;
  take: number;
}

function orderByFor(sort: CatalogueSortRow): Prisma.ServiceOrderByWithRelationInput[] {
  // A stable tiebreaker on `id` keeps pagination deterministic when the primary
  // key has ties.
  switch (sort) {
    case 'name_desc':
      return [{ name: 'desc' }, { id: 'asc' }];
    case 'price_asc':
      return [{ basePriceCents: 'asc' }, { id: 'asc' }];
    case 'price_desc':
      return [{ basePriceCents: 'desc' }, { id: 'asc' }];
    case 'newest':
      return [{ createdAt: 'desc' }, { id: 'asc' }];
    case 'name_asc':
    default:
      return [{ name: 'asc' }, { id: 'asc' }];
  }
}

function whereFor(params: SearchActiveServicesParams): Prisma.ServiceWhereInput {
  const where: Prisma.ServiceWhereInput = { active: true };

  if (params.categorySlug) {
    where.category = { slug: params.categorySlug, active: true };
  }

  if (params.q) {
    where.OR = [
      { name: { contains: params.q, mode: 'insensitive' } },
      { description: { contains: params.q, mode: 'insensitive' } },
    ];
  }

  return where;
}

export const catalogRepository = {
  listActiveCategories(): Promise<CatalogueCategoryRow[]> {
    return prisma.serviceCategory.findMany({
      where: { active: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: categorySelect,
    });
  },

  findActiveCategoryBySlug(slug: string): Promise<CatalogueCategoryRow | null> {
    return prisma.serviceCategory.findFirst({
      where: { slug, active: true },
      select: categorySelect,
    });
  },

  async searchActiveServices(
    params: SearchActiveServicesParams,
  ): Promise<{ items: CatalogueServiceRow[]; total: number }> {
    const where = whereFor(params);

    // One transaction so the count and the page come from the same snapshot.
    const [items, total] = await prisma.$transaction([
      prisma.service.findMany({
        where,
        orderBy: orderByFor(params.sort),
        select: serviceSelect,
        skip: params.skip,
        take: params.take,
      }),
      prisma.service.count({ where }),
    ]);

    return { items, total };
  },

  findActiveServiceBySlug(slug: string): Promise<CatalogueServiceRow | null> {
    return prisma.service.findFirst({
      where: { slug, active: true },
      select: serviceSelect,
    });
  },

  /**
   * The authoritative current price for an active service, and nothing else.
   * One indexed read (`Service.slug` unique + `active`), used by the pricing
   * service to build a quote.
   */
  findActivePriceBySlug(slug: string): Promise<ServicePriceRow | null> {
    return prisma.service.findFirst({
      where: { slug, active: true },
      select: servicePriceSelect,
    });
  },
};
