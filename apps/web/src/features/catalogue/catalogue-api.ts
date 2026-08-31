import type {
  CatalogueCategoryList,
  CatalogueService,
  CatalogueServiceList,
  CatalogueSort,
} from '@aisbp/shared';
import { apiRequest } from '../../lib/api';

export interface ServiceQuery {
  q?: string | undefined;
  category?: string | undefined;
  sort?: CatalogueSort | undefined;
  page?: number | undefined;
}

function toSearchParams(query: ServiceQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.category) params.set('category', query.category);
  if (query.sort) params.set('sort', query.sort);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const catalogueApi = {
  listCategories: () => apiRequest<CatalogueCategoryList>('/api/v1/categories'),
  listServices: (query: ServiceQuery) =>
    apiRequest<CatalogueServiceList>(`/api/v1/services${toSearchParams(query)}`),
  getService: (slug: string) =>
    apiRequest<{ service: CatalogueService }>(`/api/v1/services/${encodeURIComponent(slug)}`),
};
