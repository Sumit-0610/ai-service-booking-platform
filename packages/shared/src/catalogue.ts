import { z } from 'zod';

/**
 * Shared contracts for the public service catalogue. The API validates query
 * strings against `catalogueQuerySchema` and the web client uses the DTO types.
 */

export const CATALOGUE_PAGE_SIZE_DEFAULT = 12;
export const CATALOGUE_PAGE_SIZE_MAX = 48;
export const CATALOGUE_PAGE_MAX = 10_000;
export const CATALOGUE_QUERY_MAX_LENGTH = 100;

export const catalogueSortValues = [
  'name_asc',
  'name_desc',
  'price_asc',
  'price_desc',
  'newest',
] as const;
export const catalogueSortSchema = z.enum(catalogueSortValues).default('name_asc');
export type CatalogueSort = z.infer<typeof catalogueSortSchema>;

/** Treat an empty / whitespace-only string param as "not provided". */
const optionalText = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).max(CATALOGUE_QUERY_MAX_LENGTH).optional(),
);

export const catalogueQuerySchema = z.object({
  q: optionalText,
  category: optionalText,
  sort: catalogueSortSchema,
  page: z.coerce.number().int().min(1).max(CATALOGUE_PAGE_MAX).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(CATALOGUE_PAGE_SIZE_MAX)
    .default(CATALOGUE_PAGE_SIZE_DEFAULT),
});
export type CatalogueQuery = z.infer<typeof catalogueQuerySchema>;
export type CatalogueQueryInput = z.input<typeof catalogueQuerySchema>;

export const catalogueCategorySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
});
export type CatalogueCategory = z.infer<typeof catalogueCategorySchema>;

export const catalogueServiceSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  priceCents: z.number().int().nonnegative(),
  currency: z.string(),
  durationMinutes: z.number().int().positive(),
  category: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
});
export type CatalogueService = z.infer<typeof catalogueServiceSchema>;

export const paginationMetaSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export const catalogueCategoryListSchema = z.object({ items: z.array(catalogueCategorySchema) });
export type CatalogueCategoryList = z.infer<typeof catalogueCategoryListSchema>;

export const catalogueServiceListSchema = z.object({
  items: z.array(catalogueServiceSchema),
  pagination: paginationMetaSchema,
});
export type CatalogueServiceList = z.infer<typeof catalogueServiceListSchema>;

export function formatPrice(priceCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(priceCents / 100);
  } catch {
    return `${(priceCents / 100).toFixed(2)} ${currency}`;
  }
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}
