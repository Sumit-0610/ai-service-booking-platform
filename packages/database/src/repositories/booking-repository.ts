import {
  calculateServicePrice,
  canActorTransition,
  isCustomerCancellable,
  type BookingStatus,
} from '@aisbp/shared';
import { prisma } from '../client.js';
import { Prisma } from '../../generated/prisma/index.js';

/**
 * Booking workflow data access (Milestone 9).
 *
 * Creation and cancellation each run in a single `prisma.$transaction`. The
 * authoritative guard against double-booking is the `Booking.slotId` UNIQUE
 * constraint: two concurrent creates for the same slot both pass the in-memory
 * pre-checks, but only one `INSERT` can win — the loser's transaction is
 * aborted by PostgreSQL and Prisma re-throws, which we map to a friendly
 * "slot unavailable". There is no race-prone "check then insert and assume it
 * is safe".
 *
 * Every read and write is scoped to the acting `customerId` / `technicianId`,
 * so a caller can never reach another user's booking by changing an id.
 */

const bookingAddressSelect = {
  label: true,
  line1: true,
  line2: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
} satisfies Prisma.AddressSelect;

const customerBookingSelect = {
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
  address: { select: bookingAddressSelect },
} satisfies Prisma.BookingSelect;

const technicianBookingSelect = {
  id: true,
  status: true,
  scheduledStart: true,
  scheduledEnd: true,
  customerNotes: true,
  createdAt: true,
  service: { select: { slug: true, name: true } },
  address: { select: bookingAddressSelect },
  customer: { select: { name: true } },
} satisfies Prisma.BookingSelect;

const statusEventSelect = {
  fromStatus: true,
  toStatus: true,
  reason: true,
  createdAt: true,
} satisfies Prisma.BookingStatusHistorySelect;

const technicianJobSelect = {
  ...technicianBookingSelect,
  statusHistory: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: statusEventSelect,
  },
} satisfies Prisma.BookingSelect;

export type CustomerBookingRow = Prisma.BookingGetPayload<{ select: typeof customerBookingSelect }>;
export type TechnicianBookingRow = Prisma.BookingGetPayload<{
  select: typeof technicianBookingSelect;
}>;
export type TechnicianJobRow = Prisma.BookingGetPayload<{ select: typeof technicianJobSelect }>;
export type BookingStatusEventRow = Prisma.BookingStatusHistoryGetPayload<{
  select: typeof statusEventSelect;
}>;

export type TechnicianJobStatusResult =
  | { outcome: 'ok'; booking: TechnicianJobRow }
  | { outcome: 'not_found' }
  | { outcome: 'invalid_transition'; from: BookingStatus }
  | { outcome: 'conflict' };

export type BookingListSort = 'created_desc' | 'created_asc' | 'scheduled_asc' | 'scheduled_desc';

/** Shared params for the owner-scoped booking lists (customer / technician). */
export interface BookingListSearchParams {
  status?: BookingStatus | undefined;
  sort: BookingListSort;
  skip: number;
  take: number;
}

/** Deterministic ordering with an `id` tiebreaker so pages never overlap. */
function bookingListOrderBy(sort: BookingListSort): Prisma.BookingOrderByWithRelationInput[] {
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

export interface CreateBookingData {
  customerId: string;
  slotId: string;
  addressId: string;
  customerNotes: string | null;
}

export type CreateBookingResult =
  | { outcome: 'ok'; booking: CustomerBookingRow }
  | { outcome: 'address_not_found' }
  | { outcome: 'slot_not_found' }
  | { outcome: 'service_inactive' }
  | { outcome: 'slot_unavailable' }
  | { outcome: 'slot_past' };

export type CancelBookingResult =
  | { outcome: 'ok'; booking: CustomerBookingRow }
  | { outcome: 'not_found' }
  | { outcome: 'invalid_transition'; from: BookingStatus }
  | { outcome: 'conflict' };

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export const bookingRepository = {
  /**
   * Create a booking for one of the customer's own addresses on an available
   * future slot. Revalidates address ownership, the slot, its service, its
   * technician and its availability inside the transaction, snapshots the price
   * from the service row read in the same transaction, and flips the slot to
   * `booked` — all atomically.
   */
  async createForCustomer(data: CreateBookingData): Promise<CreateBookingResult> {
    try {
      return await prisma.$transaction(async (tx) => {
        const address = await tx.address.findFirst({
          where: { id: data.addressId, userId: data.customerId },
          select: { id: true },
        });
        if (!address) {
          return { outcome: 'address_not_found' as const };
        }

        const slot = await tx.availabilitySlot.findUnique({
          where: { id: data.slotId },
          select: {
            id: true,
            status: true,
            startsAt: true,
            endsAt: true,
            technicianId: true,
            serviceId: true,
            service: { select: { active: true, basePriceCents: true, currency: true } },
            technician: { select: { active: true } },
            booking: { select: { id: true } },
          },
        });
        if (!slot) {
          return { outcome: 'slot_not_found' as const };
        }
        if (!slot.service.active) {
          return { outcome: 'service_inactive' as const };
        }
        if (slot.booking !== null || slot.status !== 'available' || !slot.technician.active) {
          return { outcome: 'slot_unavailable' as const };
        }
        if (slot.startsAt.getTime() <= Date.now()) {
          return { outcome: 'slot_past' as const };
        }

        // Price snapshot: computed by the pricing calculation from the service
        // row read inside this transaction, never from the client.
        const quote = calculateServicePrice({
          basePriceCents: slot.service.basePriceCents,
          currency: slot.service.currency,
        });

        const booking = await tx.booking.create({
          data: {
            customerId: data.customerId,
            addressId: data.addressId,
            serviceId: slot.serviceId,
            technicianId: slot.technicianId,
            slotId: slot.id,
            status: 'pending',
            scheduledStart: slot.startsAt,
            scheduledEnd: slot.endsAt,
            customerNotes: data.customerNotes,
            priceCurrency: quote.currency,
            priceSubtotalCents: quote.subtotalCents,
            priceFeesTotalCents: quote.feesTotalCents,
            priceDiscountTotalCents: quote.discountTotalCents,
            priceTaxTotalCents: quote.taxTotalCents,
            priceTotalCents: quote.totalCents,
            priceBreakdown: quote.breakdown as Prisma.InputJsonValue,
            statusHistory: {
              create: {
                fromStatus: null,
                toStatus: 'pending',
                changedByUserId: data.customerId,
                reason: 'Booking created',
              },
            },
          },
          select: customerBookingSelect,
        });

        await tx.availabilitySlot.update({ where: { id: slot.id }, data: { status: 'booked' } });

        return { outcome: 'ok' as const, booking };
      });
    } catch (error) {
      // A concurrent request booked this slot first: its transaction committed,
      // ours hit the `Booking.slotId` UNIQUE index, PostgreSQL aborted our
      // transaction and Prisma re-throws here. Exactly one create wins.
      if (isUniqueViolation(error)) {
        return { outcome: 'slot_unavailable' };
      }
      throw error;
    }
  },

  async searchForCustomer(
    params: BookingListSearchParams & { customerId: string },
  ): Promise<{ items: CustomerBookingRow[]; total: number }> {
    const where: Prisma.BookingWhereInput = { customerId: params.customerId };
    if (params.status) {
      where.status = params.status;
    }
    const [items, total] = await prisma.$transaction([
      prisma.booking.findMany({
        where,
        orderBy: bookingListOrderBy(params.sort),
        select: customerBookingSelect,
        skip: params.skip,
        take: params.take,
      }),
      prisma.booking.count({ where }),
    ]);
    return { items, total };
  },

  findForCustomer(id: string, customerId: string): Promise<CustomerBookingRow | null> {
    return prisma.booking.findFirst({ where: { id, customerId }, select: customerBookingSelect });
  },

  /** Returns null when the booking does not exist or is not the customer's. */
  async statusHistoryForCustomer(
    id: string,
    customerId: string,
  ): Promise<BookingStatusEventRow[] | null> {
    const booking = await prisma.booking.findFirst({
      where: { id, customerId },
      select: {
        statusHistory: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: statusEventSelect,
        },
      },
    });
    return booking ? booking.statusHistory : null;
  },

  /**
   * Customer-initiated cancellation. Enforces the documented state machine and
   * writes a status-history entry atomically. The conditional `updateMany`
   * (status must still match what we read) keeps a concurrent cancel / future
   * status change safe.
   */
  async cancelForCustomer(id: string, customerId: string): Promise<CancelBookingResult> {
    return prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id, customerId },
        select: { id: true, status: true },
      });
      if (!booking) {
        return { outcome: 'not_found' as const };
      }
      if (!isCustomerCancellable(booking.status)) {
        return { outcome: 'invalid_transition' as const, from: booking.status };
      }

      const changed = await tx.booking.updateMany({
        where: { id, customerId, status: booking.status },
        data: { status: 'cancelled' },
      });
      if (changed.count !== 1) {
        return { outcome: 'conflict' as const };
      }

      await tx.bookingStatusHistory.create({
        data: {
          bookingId: id,
          fromStatus: booking.status,
          toStatus: 'cancelled',
          changedByUserId: customerId,
          reason: 'Cancelled by customer',
        },
      });

      const updated = await tx.booking.findUniqueOrThrow({
        where: { id },
        select: customerBookingSelect,
      });
      return { outcome: 'ok' as const, booking: updated };
    });
  },

  async searchForTechnician(
    params: BookingListSearchParams & { technicianId: string },
  ): Promise<{ items: TechnicianBookingRow[]; total: number }> {
    const where: Prisma.BookingWhereInput = { technicianId: params.technicianId };
    if (params.status) {
      where.status = params.status;
    }
    const [items, total] = await prisma.$transaction([
      prisma.booking.findMany({
        where,
        orderBy: bookingListOrderBy(params.sort),
        select: technicianBookingSelect,
        skip: params.skip,
        take: params.take,
      }),
      prisma.booking.count({ where }),
    ]);
    return { items, total };
  },

  /** One job in full, only if it is assigned to this technician. */
  findJobForTechnician(id: string, technicianId: string): Promise<TechnicianJobRow | null> {
    return prisma.booking.findFirst({
      where: { id, technicianId },
      select: technicianJobSelect,
    });
  },

  /**
   * A technician advances their own job through the `technician` transitions
   * (`assigned -> in_progress -> completed`). Ownership is enforced in the
   * `where` (`{ id, technicianId }`); another technician's booking is
   * indistinguishable from a missing one. Transactional, state-machine-checked,
   * conditional update against a concurrent change, history recorded with the
   * technician's user id. The price snapshot is never touched.
   */
  async changeJobStatusForTechnician(
    id: string,
    technicianId: string,
    technicianUserId: string,
    target: BookingStatus,
  ): Promise<TechnicianJobStatusResult> {
    return prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id, technicianId },
        select: { status: true },
      });
      if (!booking) {
        return { outcome: 'not_found' as const };
      }
      if (!canActorTransition('technician', booking.status, target)) {
        return { outcome: 'invalid_transition' as const, from: booking.status };
      }

      const changed = await tx.booking.updateMany({
        where: { id, technicianId, status: booking.status },
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
          changedByUserId: technicianUserId,
          reason: `Set to ${target} by technician`,
        },
      });

      const updated = await tx.booking.findUniqueOrThrow({
        where: { id },
        select: technicianJobSelect,
      });
      return { outcome: 'ok' as const, booking: updated };
    });
  },

  findForTechnician(id: string, technicianId: string): Promise<TechnicianBookingRow | null> {
    return prisma.booking.findFirst({
      where: { id, technicianId },
      select: technicianBookingSelect,
    });
  },
};
