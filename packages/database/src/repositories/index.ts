import { catalogRepository } from './catalog-repository.js';
import { userRepository } from './user-repository.js';

/**
 * Aggregated data-access layer. Application services depend on this object;
 * they never import Prisma or the generated client directly.
 */
export const repositories = {
  catalog: catalogRepository,
  users: userRepository,
};

export { catalogRepository, userRepository };
export type { CreateUserInput } from './user-repository.js';
export type {
  CatalogueCategoryRow,
  CatalogueServiceRow,
  CatalogueSortRow,
  SearchActiveServicesParams,
} from './catalog-repository.js';
