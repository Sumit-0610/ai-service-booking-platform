import { prisma } from '../client.js';
import { Prisma } from '../../generated/prisma/index.js';

/**
 * Availability slots.
 *
 * Overlap is enforced by the PostgreSQL exclusion constraint
 * `availability_slot_no_overlap` (GiST over `technicianId` + `tstzrange`),
 * added in the initial migration. This repository never does a
 * "read then insert" overlap check: it simply attempts the write and maps the
 * database's rejection to a friendly outcome, which stays correct under
 * concurrent requests.
 */

const publicSlotSelect = {
  id: true,
  startsAt: true,
  endsAt: true,
} satisfies Prisma.AvailabilitySlotSelect;

const technicianSlotSelect = {
  id: true,
  startsAt: true,
  endsAt: true,
  status: true,
  serviceId: true,
  service: { select: { slug: true, name: true } },
  booking: { select: { id: true } },
} satisfies Prisma.AvailabilitySlotSelect;

export type PublicSlotRow = Prisma.AvailabilitySlotGetPayload<{ select: typeof publicSlotSelect }>;
export type TechnicianSlotRow = Prisma.AvailabilitySlotGetPayload<{
  select: typeof technicianSlotSelect;
}>;

export interface SlotWriteInput {
  serviceId: string;
  startsAt: Date;
  endsAt: Date;
}

export type SlotWriteResult =
  | { outcome: 'ok'; slot: TechnicianSlotRow }
  | { outcome: 'overlap' }
  | { outcome: 'invalid_time' }
  | { outcome: 'not_found' };

function postgresErrorCode(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return /code:\s*"([0-9A-Za-z]+)"/.exec(error.message)?.[1] ?? null;
  }
  return null;
}

function isOverlapViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return true; // exact (technicianId, serviceId, startsAt) duplicate
  }
  return postgresErrorCode(error) === '23P01'; // exclusion_violation
}

function isTimeCheckViolation(error: unknown): boolean {
  return postgresErrorCode(error) === '23514'; // check_violation (endsAt > startsAt)
}

function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

export const availabilityRepository = {
  /** Future, bookable slots for one service, within a bounded window. */
  listPublicForService(params: {
    serviceId: string;
    from: Date;
    to: Date;
    now: Date;
  }): Promise<PublicSlotRow[]> {
    const lowerBound = params.from > params.now ? params.from : params.now;
    return prisma.availabilitySlot.findMany({
      where: {
        serviceId: params.serviceId,
        status: 'available',
        booking: { is: null },
        technician: { active: true },
        startsAt: { gte: lowerBound, lt: params.to },
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      select: publicSlotSelect,
    });
  },

  listForTechnician(params: {
    technicianId: string;
    from: Date;
    to: Date;
  }): Promise<TechnicianSlotRow[]> {
    return prisma.availabilitySlot.findMany({
      where: {
        technicianId: params.technicianId,
        startsAt: { gte: params.from, lt: params.to },
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      select: technicianSlotSelect,
    });
  },

  findForTechnician(id: string, technicianId: string): Promise<TechnicianSlotRow | null> {
    return prisma.availabilitySlot.findFirst({
      where: { id, technicianId },
      select: technicianSlotSelect,
    });
  },

  async createForTechnician(technicianId: string, data: SlotWriteInput): Promise<SlotWriteResult> {
    try {
      const slot = await prisma.availabilitySlot.create({
        data: {
          technicianId,
          serviceId: data.serviceId,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
        },
        select: technicianSlotSelect,
      });
      return { outcome: 'ok', slot };
    } catch (error) {
      if (isOverlapViolation(error)) return { outcome: 'overlap' };
      if (isTimeCheckViolation(error)) return { outcome: 'invalid_time' };
      throw error;
    }
  },

  async updateForTechnician(
    id: string,
    technicianId: string,
    data: Partial<SlotWriteInput>,
  ): Promise<SlotWriteResult> {
    const patch: Prisma.AvailabilitySlotUpdateInput = {};
    if (data.serviceId !== undefined) patch.service = { connect: { id: data.serviceId } };
    if (data.startsAt !== undefined) patch.startsAt = data.startsAt;
    if (data.endsAt !== undefined) patch.endsAt = data.endsAt;

    try {
      const slot = await prisma.availabilitySlot.update({
        where: { id, technicianId },
        data: patch,
        select: technicianSlotSelect,
      });
      return { outcome: 'ok', slot };
    } catch (error) {
      if (isRecordNotFound(error)) return { outcome: 'not_found' };
      if (isOverlapViolation(error)) return { outcome: 'overlap' };
      if (isTimeCheckViolation(error)) return { outcome: 'invalid_time' };
      throw error;
    }
  },

  async deleteForTechnician(
    id: string,
    technicianId: string,
  ): Promise<'deleted' | 'not_found' | 'in_use'> {
    try {
      await prisma.availabilitySlot.delete({ where: { id, technicianId } });
      return 'deleted';
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') return 'not_found';
        if (error.code === 'P2003') return 'in_use'; // referenced by a booking
      }
      throw error;
    }
  },
};
