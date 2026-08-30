import { prisma } from '../client.js';
import type { Service, ServiceCategory } from '../../generated/prisma/index.js';

/**
 * Read access to the public service catalogue. This is the only sanctioned way
 * for application code to reach catalogue tables; controllers and UI code must
 * not touch Prisma directly.
 *
 * Only the queries needed by the database-foundation milestone live here. The
 * full catalogue/search repository arrives with the service-catalogue milestone.
 */
export const catalogRepository = {
  listActiveCategories(): Promise<ServiceCategory[]> {
    return prisma.serviceCategory.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
  },

  listActiveServices(): Promise<Service[]> {
    return prisma.service.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
  },

  findServiceBySlug(slug: string): Promise<Service | null> {
    return prisma.service.findUnique({ where: { slug } });
  },
};
