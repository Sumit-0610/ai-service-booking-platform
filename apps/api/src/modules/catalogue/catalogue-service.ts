import { repositories, type CatalogueCategoryRow, type CatalogueServiceRow } from '@aisbp/database';
import type {
  CatalogueCategory,
  CatalogueQuery,
  CatalogueService,
  CatalogueServiceList,
} from '@aisbp/shared';
import { AppError } from '../../lib/errors.js';

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

export const catalogueService = {
  async listCategories(): Promise<CatalogueCategory[]> {
    const rows = await repositories.catalog.listActiveCategories();
    return rows.map(toCategory);
  },

  async listServices(query: CatalogueQuery): Promise<CatalogueServiceList> {
    const skip = (query.page - 1) * query.limit;
    const { items, total } = await repositories.catalog.searchActiveServices({
      q: query.q,
      categorySlug: query.category,
      sort: query.sort,
      skip,
      take: query.limit,
    });

    const totalPages = total === 0 ? 0 : Math.ceil(total / query.limit);

    return {
      items: items.map(toService),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPreviousPage: query.page > 1,
      },
    };
  },

  async getServiceBySlug(slug: string): Promise<CatalogueService> {
    const row = await repositories.catalog.findActiveServiceBySlug(slug);
    if (!row) {
      throw new AppError('NOT_FOUND', 'Service not found');
    }
    return toService(row);
  },
};
