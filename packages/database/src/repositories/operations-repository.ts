import { canActorTransition, type BookingStatus } from '@aisbp/shared';
import { prisma } from '../client.js';
import { Prisma } from '../../generated/prisma/index.js';

/**
 * Operations data access (Milestone 10).
 *
 * Unlike the customer / technician booking repositories, operations reads are
 * **not** owner-scoped — an operator sees every booking. Access is gated by the
 * `operations` role in middleware, never here. Every query still uses an
 * explicit narrow `select`, DB-side filtering / pagination, and deterministic
 * ordering; no client-supplied `where` / `select` / `orderBy` reaches Prisma.
 *
 * Dashboard metrics are computed with aggregation queries, never by loading the
 * bookings table into memory.
 */

const opsAddressSelect = {
  label: true,
  line1: true,
  line2: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
} satisfies Prisma.AddressSelect;

const opsSummarySelect = {
  id: true,
  status: true,
  scheduledStart: true,
  scheduledEnd: true,
  createdAt: true,
  priceTotalCents: true,
  priceCurrency: true,
  service: { select: { slug: true, name: true } },
  customer: { select: { name: true } },
  technician: { select: { displayName: true } },
} satisfies Prisma.BookingSelect;

const opsDetailSelect = {
  id: true,
  status: true,
  scheduledStart: true,
  scheduledEnd: true,
  customerNotes: true,
  createdAt: true,
  priceCurrency: true,
  priceSubtotalCents: true,
  priceFeesTotalCents: true,
  priceDiscountTotalCents: true,
  priceTaxTotalCents: true,
  priceTotalCents: true,
  priceBreakdown: true,
  service: { select: { slug: true, name: true } },
  customer: { select: { name: true, email: true } },
  technician: { select: { displayName: true } },
  address: { select: opsAddressSelect },
  statusHistory: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      fromStatus: true,
      toStatus: true,
      reason: true,
      createdAt: true,
      changedBy: { select: { name: true, role: true } },
    },
  },
} satisfies Prisma.BookingSelect;

export type OperationsBookingSummaryRow = Prisma.BookingGetPayload<{
  select: typeof opsSummarySelect;
}>;
export type OperationsBookingDetailRow = Prisma.BookingGetPayload<{
  select: typeof opsDetailSelect;
}>;

export interface OperationsBookingSearchParams {
  status?: BookingStatus | undefined;
  q?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  sort: 'created_desc' | 'created_asc' | 'scheduled_asc' | 'scheduled_desc';
  skip: number;
  take: number;
}

export interface OperationsDashboardCounts {
  total: number;
  byStatus: Record<BookingStatus, number>;
  active: number;
  upcoming: number;
  revenueByCurrency: { currency: string; committedTotalCents: number }[];
  technicians: { total: number; active: number };
}

export type OperationsStatusChangeResult =
  | { outcome: 'ok'; booking: OperationsBookingDetailRow }
  | { outcome: 'not_found' }
  | { outcome: 'invalid_transition'; from: BookingStatus }
  | { outcome: 'conflict' };

export type AssignTechnicianResult =
  | { outcome: 'ok'; booking: OperationsBookingDetailRow }
  | { outcome: 'booking_not_found' }
  | { outcome: 'technician_not_found' }
  | { outcome: 'technician_inactive' }
  | { outcome: 'not_qualified' }
  | { outcome: 'invalid_state'; status: BookingStatus }
  | { outcome: 'already_assigned' }
  | { outcome: 'schedule_conflict' }
  | { outcome: 'conflict' };

export interface AssignableTechnicianRow {
  id: string;
  displayName: string;
  serviceArea: string;
  hasScheduleConflict: boolean;
}

/** Booking statuses that count as a technician's live commitment for
 * overlap checks. */
const COMMITTED: BookingStatus[] = ['confirmed', 'assigned', 'in_progress'];

const ACTIVE: BookingStatus[] = ['pending', 'confirmed', 'assigned', 'in_progress'];
const NON_REVENUE: BookingStatus[] = ['cancelled', 'rejected'];
const ALL_STATUSES: BookingStatus[] = [
  'pending',
  'confirmed',
  'assigned',
  'in_progress',
  'completed',
  'cancelled',
  'rejected',
];

function orderByFor(
  sort: OperationsBookingSearchParams['sort'],
): Prisma.BookingOrderByWithRelationInput[] {
  switch (sort) {
    case 'created_asc':
      return [{ createdAt: 'asc' }, { id: 'asc' }];
    case 'scheduled_asc':
      return [{ scheduledStart: 'asc' }, { id: 'asc' }];
    case 'scheduled_desc':
      return [{ scheduledStart: 'desc' }, { id: 'asc' }];
    case 'created_desc':
    default:
      return [{ createdAt: 'desc' }, { id: 'asc' }];
  }
}

function whereFor(params: OperationsBookingSearchParams): Prisma.BookingWhereInput {
  const where: Prisma.BookingWhereInput = {};
  if (params.status) {
    where.status = params.status;
  }
  if (params.from || params.to) {
    where.scheduledStart = {
      ...(params.from ? { gte: params.from } : {}),
      ...(params.to ? { lt: params.to } : {}),
    };
  }
  if (params.q) {
    where.OR = [
      { customer: { name: { contains: params.q, mode: 'insensitive' } } },
      { customer: { email: { contains: params.q, mode: 'insensitive' } } },
      { service: { name: { contains: params.q, mode: 'insensitive' } } },
    ];
  }
  return where;
}

export const operationsRepository = {
  async searchBookings(
    params: OperationsBookingSearchParams,
  ): Promise<{ items: OperationsBookingSummaryRow[]; total: number }> {
    const where = whereFor(params);
    const [items, total] = await prisma.$transaction([
      prisma.booking.findMany({
        where,
        orderBy: orderByFor(params.sort),
        select: opsSummarySelect,
        skip: params.skip,
        take: params.take,
      }),
      prisma.booking.count({ where }),
    ]);
    return { items, total };
  },

  findBookingById(id: string): Promise<OperationsBookingDetailRow | null> {
    return prisma.booking.findUnique({ where: { id }, select: opsDetailSelect });
  },

  async dashboard(): Promise<OperationsDashboardCounts> {
    const now = new Date();
    const [total, grouped, active, upcoming, revenue, techTotal, techActive] = await Promise.all([
      prisma.booking.count(),
      prisma.booking.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.booking.count({ where: { status: { in: ACTIVE } } }),
      prisma.booking.count({
        where: { status: { in: ACTIVE }, scheduledStart: { gte: now } },
      }),
      prisma.booking.groupBy({
        by: ['priceCurrency'],
        where: { status: { notIn: NON_REVENUE } },
        _sum: { priceTotalCents: true },
      }),
      prisma.technician.count(),
      prisma.technician.count({ where: { active: true } }),
    ]);

    const byStatus = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<
      BookingStatus,
      number
    >;
    for (const row of grouped) {
      byStatus[row.status] = row._count._all;
    }

    return {
      total,
      byStatus,
      active,
      upcoming,
      revenueByCurrency: revenue
        .map((row) => ({
          currency: row.priceCurrency,
          committedTotalCents: row._sum.priceTotalCents ?? 0,
        }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
      technicians: { total: techTotal, active: techActive },
    };
  },

  /**
   * Move a booking through an operations transition. Enforces the shared state
   * machine, records `BookingStatusHistory` with the acting operator, and uses
   * a conditional `updateMany` so a concurrent status change is caught rather
   * than silently overwritten.
   */
  async changeStatus(
    id: string,
    operatorUserId: string,
    target: BookingStatus,
    reason: string | null,
  ): Promise<OperationsStatusChangeResult> {
    return prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id }, select: { status: true } });
      if (!booking) {
        return { outcome: 'not_found' as const };
      }
      if (!canActorTransition('operations', booking.status, target)) {
        return { outcome: 'invalid_transition' as const, from: booking.status };
      }

      const changed = await tx.booking.updateMany({
        where: { id, status: booking.status },
        data: { status: target },
      });
      if (changed.count !== 1) {
        return { outcome: 'conflict' as const };
      }

      await tx.bookingStatusHistory.create({
        data: {
          bookingId: id,
          fromStatus: booking.status,
          toStatus: target,
          changedByUserId: operatorUserId,
          reason: reason ?? `Set to ${target} by operations`,
        },
      });

      const updated = await tx.booking.findUniqueOrThrow({
        where: { id },
        select: opsDetailSelect,
      });
      return { outcome: 'ok' as const, booking: updated };
    });
  },

  /**
   * Assign (or reassign) a technician to a booking. Runs in one transaction
   * that first takes a `FOR UPDATE` row lock on the target `Technician`, so
   * concurrent assignments / deactivations / qualification changes for that
   * technician serialise. Validates: booking exists and is `confirmed` or
   * `assigned`; target technician exists and is active; target technician is
   * qualified for the booking's service; target technician has no overlapping
   * committed booking. The booking keeps its slot — assignment changes
   * `Booking.technicianId` and moves the status to `assigned`. The conditional
   * `updateMany` guards against a concurrent status change to this booking.
   */
  async assignTechnician(
    bookingId: string,
    operatorUserId: string,
    targetTechnicianId: string,
    reason: string | null,
  ): Promise<AssignTechnicianResult> {
    return prisma.$transaction(async (tx) => {
      const techRows = await tx.$queryRaw<
        { active: boolean }[]
      >`SELECT active FROM "Technician" WHERE id = ${targetTechnicianId} FOR UPDATE`;
      if (techRows.length === 0) {
        return { outcome: 'technician_not_found' as const };
      }
      if (!techRows[0]?.active) {
        return { outcome: 'technician_inactive' as const };
      }

      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: {
          status: true,
          serviceId: true,
          technicianId: true,
          scheduledStart: true,
          scheduledEnd: true,
        },
      });
      if (!booking) {
        return { outcome: 'booking_not_found' as const };
      }
      if (booking.status !== 'confirmed' && booking.status !== 'assigned') {
        return { outcome: 'invalid_state' as const, status: booking.status };
      }
      if (booking.technicianId === targetTechnicianId) {
        return { outcome: 'already_assigned' as const };
      }

      const qualified = await tx.technicianService.findUnique({
        where: {
          technicianId_serviceId: {
            technicianId: targetTechnicianId,
            serviceId: booking.serviceId,
          },
        },
        select: { id: true },
      });
      if (!qualified) {
        return { outcome: 'not_qualified' as const };
      }

      const clash = await tx.booking.findFirst({
        where: {
          technicianId: targetTechnicianId,
          id: { not: bookingId },
          status: { in: COMMITTED },
          scheduledStart: { lt: booking.scheduledEnd },
          scheduledEnd: { gt: booking.scheduledStart },
        },
        select: { id: true },
      });
      if (clash) {
        return { outcome: 'schedule_conflict' as const };
      }

      const changed = await tx.booking.updateMany({
        where: { id: bookingId, status: booking.status, technicianId: booking.technicianId },
        data: { technicianId: targetTechnicianId, status: 'assigned' },
      });
      if (changed.count !== 1) {
        return { outcome: 'conflict' as const };
      }

      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: booking.status,
          toStatus: 'assigned',
          changedByUserId: operatorUserId,
          reason:
            reason ??
            (booking.status === 'confirmed'
              ? 'Assigned to a technician by operations'
              : 'Reassigned to another technician by operations'),
        },
      });

      const updated = await tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
        select: opsDetailSelect,
      });
      return { outcome: 'ok' as const, booking: updated };
    });
  },

  /** Active technicians qualified for a booking's service, with an overlap flag.
   * Excludes the currently-assigned technician. Two queries, no N+1. */
  async assignableForBooking(
    bookingId: string,
  ): Promise<{ outcome: 'ok'; items: AssignableTechnicianRow[] } | { outcome: 'not_found' }> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { serviceId: true, technicianId: true, scheduledStart: true, scheduledEnd: true },
    });
    if (!booking) {
      return { outcome: 'not_found' };
    }

    const where: Prisma.TechnicianWhereInput = {
      active: true,
      qualifications: { some: { serviceId: booking.serviceId } },
    };
    if (booking.technicianId) {
      where.id = { not: booking.technicianId };
    }
    const technicians = await prisma.technician.findMany({
      where,
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      select: { id: true, displayName: true, serviceArea: true },
    });

    const ids = technicians.map((t) => t.id);
    const clashes = ids.length
      ? await prisma.booking.findMany({
          where: {
            technicianId: { in: ids },
            id: { not: bookingId },
            status: { in: COMMITTED },
            scheduledStart: { lt: booking.scheduledEnd },
            scheduledEnd: { gt: booking.scheduledStart },
          },
          select: { technicianId: true },
        })
      : [];
    const clashing = new Set(clashes.map((c) => c.technicianId));

    return {
      outcome: 'ok',
      items: technicians.map((t) => ({
        id: t.id,
        displayName: t.displayName,
        serviceArea: t.serviceArea,
        hasScheduleConflict: clashing.has(t.id),
      })),
    };
  },
};
