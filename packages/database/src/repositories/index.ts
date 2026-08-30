import { catalogRepository } from './catalog-repository.js';

/**
 * Aggregated data-access layer. Application services depend on this object;
 * they never import Prisma or the generated client directly.
 */
export const repositories = {
  catalog: catalogRepository,
};

export { catalogRepository };
