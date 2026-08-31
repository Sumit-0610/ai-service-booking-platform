import { ACTIVE_BOOKING_STATUSES, type BookingStatus } from '@aisbp/shared';
import { prisma } from '../client.js';
import { Prisma } from '../../generated/prisma/index.js';

/**
 * The technician profile linked to a user account, plus the operations-facing
 * management surface added in Milestone 11 (list / detail / active status /
 * service qualifications) and the technician's own read-only profile.
 *
 * Every state-changing method that must serialise with booking assignment
 * (`setActive`, `addQualification`, `removeQualification`) takes a
 * `SELECT ... FOR UPDATE` row lock on the target `Technician` first, so a
 * concurrent assignment sees a consistent active/qualification state.
 */

const opsSummarySelect = {
  id: true,
  displayName: true,
  serviceArea: true,
  active: true,
  user: { select: { name: true, email: true } },
  _count: { select: { qualifications: true } },
} satisfies Prisma.TechnicianSelect;

const opsDetailSelect = {
  ...opsSummarySelect,
  qualifications: {
    orderBy: { service: { name: 'asc' } },
    select: {
      service: { select: { id: true, slug: true, name: true, active: true } },
    },
  },
} satisfies Prisma.TechnicianSelect;

export type OperationsTechnicianSummaryRow = Prisma.TechnicianGetPayload<{
  select: typeof opsSummarySelect;
}> & { activeAssignmentCount: number };
export type OperationsTechnicianDetailRow = Prisma.TechnicianGetPayload<{
  select: typeof opsDetailSelect;
}> & { activeAssignmentCount: number };

export interface TechnicianSearchParams {
  active?: boolean | undefined;
  q?: string | undefined;
  skip: number;
  take: number;
}

export type AddQualificationResult =
  | { outcome: 'ok' }
  | { outcome: 'technician_not_found' }
  | { outcome: 'service_not_found' }
  | { outcome: 'service_inactive' }
  | { outcome: 'duplicate' };

const ACTIVE = ACTIVE_BOOKING_STATUSES as BookingStatus[];

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function searchWhere(params: TechnicianSearchParams): Prisma.TechnicianWhereInput {
  const where: Prisma.TechnicianWhereInput = {};
  if (params.active !== undefined) {
    where.active = params.active;
  }
  if (params.q) {
    where.OR = [
      { displayName: { contains: params.q, mode: 'insensitive' } },
      { user: { name: { contains: params.q, mode: 'insensitive' } } },
      { user: { email: { contains: params.q, mode: 'insensitive' } } },
    ];
  }
  return where;
}

/** Count of non-terminal bookings assigned to each of `technicianIds`. */
async function activeAssignmentCounts(technicianIds: string[]): Promise<Map<string, number>> {
  if (technicianIds.length === 0) {
    return new Map();
  }
  const grouped = await prisma.booking.groupBy({
    by: ['technicianId'],
    where: { technicianId: { in: technicianIds }, status: { in: ACTIVE } },
    _count: { _all: true },
  });
  const map = new Map<string, number>();
  for (const row of grouped) {
    if (row.technicianId) {
      map.set(row.technicianId, row._count._all);
    }
  }
  return map;
}

export const technicianRepository = {
  findByUserId(userId: string): Promise<{ id: string; active: boolean } | null> {
    return prisma.technician.findUnique({
      where: { userId },
      select: { id: true, active: true },
    });
  },

  async listForOperations(
    params: TechnicianSearchParams,
  ): Promise<{ items: OperationsTechnicianSummaryRow[]; total: number }> {
    const where = searchWhere(params);
    const [rows, total] = await prisma.$transaction([
      prisma.technician.findMany({
        where,
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        select: opsSummarySelect,
        skip: params.skip,
        take: params.take,
      }),
      prisma.technician.count({ where }),
    ]);
    const counts = await activeAssignmentCounts(rows.map((r) => r.id));
    return {
      items: rows.map((r) => ({ ...r, activeAssignmentCount: counts.get(r.id) ?? 0 })),
      total,
    };
  },

  async findByIdForOperations(id: string): Promise<OperationsTechnicianDetailRow | null> {
    const row = await prisma.technician.findUnique({ where: { id }, select: opsDetailSelect });
    if (!row) {
      return null;
    }
    const counts = await activeAssignmentCounts([id]);
    return { ...row, activeAssignmentCount: counts.get(id) ?? 0 };
  },

  profileForUser(userId: string): Promise<{
    displayName: string;
    serviceArea: string;
    active: boolean;
    qualifications: { service: { slug: string; name: string } }[];
  } | null> {
    return prisma.technician.findUnique({
      where: { userId },
      select: {
        displayName: true,
        serviceArea: true,
        active: true,
        qualifications: {
          orderBy: { service: { name: 'asc' } },
          select: { service: { select: { slug: true, name: true } } },
        },
      },
    });
  },

  async setActive(id: string, active: boolean): Promise<'ok' | 'not_found'> {
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        unknown[]
      >`SELECT id FROM "Technician" WHERE id = ${id} FOR UPDATE`;
      if (locked.length === 0) {
        return 'not_found';
      }
      await tx.technician.update({ where: { id }, data: { active } });
      return 'ok';
    });
  },

  async addQualification(technicianId: string, serviceId: string): Promise<AddQualificationResult> {
    try {
      return await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<
          unknown[]
        >`SELECT id FROM "Technician" WHERE id = ${technicianId} FOR UPDATE`;
        if (locked.length === 0) {
          return { outcome: 'technician_not_found' as const };
        }
        const service = await tx.service.findUnique({
          where: { id: serviceId },
          select: { active: true },
        });
        if (!service) {
          return { outcome: 'service_not_found' as const };
        }
        if (!service.active) {
          return { outcome: 'service_inactive' as const };
        }
        await tx.technicianService.create({ data: { technicianId, serviceId } });
        return { outcome: 'ok' as const };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { outcome: 'duplicate' };
      }
      throw error;
    }
  },

  async removeQualification(
    technicianId: string,
    serviceId: string,
  ): Promise<'removed' | 'not_found'> {
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        unknown[]
      >`SELECT id FROM "Technician" WHERE id = ${technicianId} FOR UPDATE`;
      if (locked.length === 0) {
        return 'not_found';
      }
      const deleted = await tx.technicianService.deleteMany({ where: { technicianId, serviceId } });
      return deleted.count === 1 ? 'removed' : 'not_found';
    });
  },
};
