import { z } from 'zod';

/**
 * Shared pagination contract (Milestone 12).
 *
 * Every paginated list endpoint uses `page` / `limit` query params and returns
 * a `pagination` block of the same shape. `page` and `limit` are always
 * server-bounded; an out-of-range value is a `422`, never silently clamped.
 * Ordering always carries an `id` tiebreaker so pages never overlap or skip.
 */

/** Upper bound on `page` for every list endpoint (guards against silly offsets). */
export const PAGE_MAX = 10_000;
/** Default cap on `limit` when an endpoint does not set its own. */
export const PAGE_SIZE_MAX = 100;
export const PAGE_SIZE_DEFAULT = 20;

/**
 * `{ page, limit }` query fields for a `z.object({ ... })`. `page` defaults to 1;
 * `limit` defaults / caps are per-endpoint so existing contracts keep their
 * values (catalogue 12/48, operations 20/100, customer & technician 10/50).
 */
export function pageParams(opts?: { defaultLimit?: number; maxLimit?: number }) {
  const maxLimit = opts?.maxLimit ?? PAGE_SIZE_MAX;
  const defaultLimit = opts?.defaultLimit ?? PAGE_SIZE_DEFAULT;
  return {
    page: z.coerce.number().int().min(1).max(PAGE_MAX).default(1),
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
  };
}

export const paginationMetaSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

/** Zero-based offset for a `page`/`limit` pair. */
export function pageOffset(page: number, limit: number): number {
  return (page - 1) * limit;
}

/**
 * The standard pagination metadata for a page of `total` rows. Deterministic;
 * performs no clamping — a `page` past the end simply yields an empty page with
 * `hasNextPage: false`.
 */
export function paginationMeta(page: number, limit: number, total: number): PaginationMeta {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}
