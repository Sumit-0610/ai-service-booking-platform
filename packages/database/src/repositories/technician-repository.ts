import { prisma } from '../client.js';

/**
 * The technician profile linked to a user account. Availability ownership is
 * keyed by `Technician.id`, resolved from the authenticated `User.id` here.
 */
export const technicianRepository = {
  findByUserId(userId: string): Promise<{ id: string; active: boolean } | null> {
    return prisma.technician.findUnique({
      where: { userId },
      select: { id: true, active: true },
    });
  },
};
