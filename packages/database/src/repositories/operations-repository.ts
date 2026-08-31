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
};
