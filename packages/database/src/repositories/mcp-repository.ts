import { isCustomerReschedulable, type BookingStatus } from '@aisbp/shared';
import { prisma } from '../client.js';
import { Prisma } from '../../generated/prisma/index.js';

/**
 * Data access for the standalone MCP server (`mcp-server/`).
 *
 * The MCP server exposes booking tools to an LLM agent. It reuses
 * `bookingRepository` for the create/cancel transactions (price snapshot +
 * `Booking.slotId` UNIQUE double-booking guard live there); this repository
 * only adds the few reads and the one write (`rescheduleBooking`) that the
 * agent tools need and that no existing repository exposes:
 *
 *  - service lookup by slug *or* human name (an agent is given a "service type",
 *    not a URL slug),
 *  - public availability filtered by a free-text service area ("location"),
 *  - a booking read with the technician / customer / history the tool response
 *    needs (`bookingRepository.findForCustomer` selects a narrower shape),
 *  - moving a booking to a different available slot.
 *
 * Every booking method here is scoped to the acting `customerId`, exactly like
 * `bookingRepository` — the MCP server resolves its actor at startup and can
 * only ever touch that customer's rows.
 *
 * Overlap / double-booking safety is unchanged: the new slot flip relies on the
 * same `Booking.slotId` UNIQUE constraint, and a concurrent winner aborts our
 * transaction (caught as `slot_unavailable`).
 */

const serviceRefSelect = {
  id: true,
  slug: true,
  name: true,
} satisfies Prisma.ServiceSelect;

const bookableSlotSelect = {
  id: true,
  status: true,
  startsAt: true,
  endsAt: true,
  serviceId: true,
  service: { select: { slug: true, name: true, active: true } },
  technician: { select: { displayName: true, serviceArea: true, active: true } },
  booking: { select: { id: true } },
} satisfies Prisma.AvailabilitySlotSelect;

const availableSlotSelect = {
  id: true,
  startsAt: true,
  endsAt: true,
  technician: { select: { displayName: true, serviceArea: true } },
} satisfies Prisma.AvailabilitySlotSelect;

const bookingDetailSelect = {
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
  address: {
    select: {
      label: true,
      line1: true,
      line2: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
    },
  },
  technician: { select: { displayName: true, serviceArea: true } },
  customer: { select: { name: true, email: true } },
  statusHistory: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { fromStatus: true, toStatus: true, reason: true, createdAt: true },
  },
} satisfies Prisma.BookingSelect;

export type McpServiceRefRow = Prisma.ServiceGetPayload<{ select: typeof serviceRefSelect }>;
export type McpBookableSlotRow = Prisma.AvailabilitySlotGetPayload<{
  select: typeof bookableSlotSelect;
}>;
export type McpAvailableSlotRow = Prisma.AvailabilitySlotGetPayload<{
  select: typeof availableSlotSelect;
}>;
export type McpBookingDetailRow = Prisma.BookingGetPayload<{ select: typeof bookingDetailSelect }>;

export type RescheduleBookingResult =
  | { outcome: 'ok'; booking: McpBookingDetailRow }
  | { outcome: 'booking_not_found' }
  | { outcome: 'not_reschedulable'; from: BookingStatus }
  | { outcome: 'slot_not_found' }
  | { outcome: 'slot_unavailable' }
  | { outcome: 'slot_past' }
  | { outcome: 'service_mismatch' };

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export const mcpRepository = {
  /**
   * An active service matched by exact slug or by case-insensitive name — an
   * agent is handed a "service type" phrase, not a URL slug. Slug is tried
   * first so an exact slug always wins.
   */
  async findActiveServiceByTerm(term: string): Promise<McpServiceRefRow | null> {
    const bySlug = await prisma.service.findFirst({
      where: { slug: term, active: true },
      select: serviceRefSelect,
    });
    if (bySlug) {
      return bySlug;
    }
    return prisma.service.findFirst({
      where: { name: { equals: term, mode: 'insensitive' }, active: true },
      select: serviceRefSelect,
    });
  },

  /** One slot by id, with everything needed to decide if it can be booked. */
  findSlotById(id: string): Promise<McpBookableSlotRow | null> {
    return prisma.availabilitySlot.findUnique({ where: { id }, select: bookableSlotSelect });
  },

  /**
   * Future, bookable slots for a service inside `[max(from, now), to)`,
   * optionally restricted to technicians whose free-text `serviceArea` contains
   * `location`. Ordering and the row cap mirror the public availability query.
   */
  listAvailableSlots(params: {
    serviceId: string;
    from: Date;
    to: Date;
    now: Date;
    location?: string | undefined;
    take: number;
  }): Promise<McpAvailableSlotRow[]> {
    const lowerBound = params.from > params.now ? params.from : params.now;
    const where: Prisma.AvailabilitySlotWhereInput = {
      serviceId: params.serviceId,
      status: 'available',
      booking: { is: null },
      technician: { active: true },
      startsAt: { gte: lowerBound, lt: params.to },
    };
    if (params.location) {
      where.technician = {
        active: true,
        serviceArea: { contains: params.location, mode: 'insensitive' },
      };
    }
    return prisma.availabilitySlot.findMany({
      where,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      select: availableSlotSelect,
      take: params.take,
    });
  },

  /**
   * One of the acting customer's bookings in full. Scoped by `customerId`, so
   * another customer's booking id is indistinguishable from a missing one.
   */
  findBookingForCustomer(id: string, customerId: string): Promise<McpBookingDetailRow | null> {
    return prisma.booking.findFirst({ where: { id, customerId }, select: bookingDetailSelect });
  },

  /**
   * Move one of the acting customer's bookings to a different available slot of
   * the *same* service. Runs in one transaction: the old slot is released back
   * to `available`, the new slot is flipped to `booked`, and the booking's slot
   * / technician / scheduled window are updated. The price snapshot is left
   * untouched — it was frozen when the booking was created. A status-history row
   * records the move (status is unchanged).
   *
   * Scoped by `customerId` (another customer's booking → `booking_not_found`).
   * Only `pending` / `confirmed` bookings can be moved this way — see
   * `isCustomerReschedulable`. The status-guarded `updateMany` and the
   * `Booking.slotId` UNIQUE index keep it correct under a concurrent cancel or
   * a race for the same new slot.
   */
  async rescheduleBooking(
    bookingId: string,
    customerId: string,
    newSlotId: string,
  ): Promise<RescheduleBookingResult> {
    try {
      return await prisma.$transaction(async (tx) => {
        const booking = await tx.booking.findFirst({
          where: { id: bookingId, customerId },
          select: { id: true, status: true, serviceId: true, slotId: true },
        });
        if (!booking) {
          return { outcome: 'booking_not_found' as const };
        }
        if (!isCustomerReschedulable(booking.status)) {
          return { outcome: 'not_reschedulable' as const, from: booking.status };
        }

        const slot = await tx.availabilitySlot.findUnique({
          where: { id: newSlotId },
          select: {
            id: true,
            status: true,
            startsAt: true,
            endsAt: true,
            serviceId: true,
            technicianId: true,
            service: { select: { active: true } },
            technician: { select: { active: true } },
            booking: { select: { id: true } },
          },
        });
        if (!slot) {
          return { outcome: 'slot_not_found' as const };
        }
        if (slot.serviceId !== booking.serviceId) {
          return { outcome: 'service_mismatch' as const };
        }
        if (
          slot.booking !== null ||
          slot.status !== 'available' ||
          !slot.technician.active ||
          !slot.service.active
        ) {
          return { outcome: 'slot_unavailable' as const };
        }
        if (slot.startsAt.getTime() <= Date.now()) {
          return { outcome: 'slot_past' as const };
        }
        if (slot.id === booking.slotId) {
          // Nothing to do, but return the current state rather than error.
          const unchanged = await tx.booking.findUniqueOrThrow({
            where: { id: bookingId },
            select: bookingDetailSelect,
          });
          return { outcome: 'ok' as const, booking: unchanged };
        }

        // Guard the move on the status we just read: a concurrent cancel (or
        // any future status change) makes this a no-op and we bail out.
        const moved = await tx.booking.updateMany({
          where: { id: bookingId, customerId, status: booking.status },
          data: {
            slotId: slot.id,
            technicianId: slot.technicianId,
            scheduledStart: slot.startsAt,
            scheduledEnd: slot.endsAt,
          },
        });
        if (moved.count !== 1) {
          return { outcome: 'not_reschedulable' as const, from: booking.status };
        }

        await tx.availabilitySlot.update({
          where: { id: booking.slotId },
          data: { status: 'available' },
        });
        await tx.availabilitySlot.update({ where: { id: slot.id }, data: { status: 'booked' } });
        await tx.bookingStatusHistory.create({
          data: {
            bookingId,
            fromStatus: booking.status,
            toStatus: booking.status,
            reason: 'Rescheduled to a new slot',
          },
        });

        const updated = await tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
          select: bookingDetailSelect,
        });
        return { outcome: 'ok' as const, booking: updated };
      });
    } catch (error) {
      // A concurrent request booked the new slot first: its commit took the
      // `Booking.slotId` UNIQUE index and PostgreSQL aborted our transaction.
      if (isUniqueViolation(error)) {
        return { outcome: 'slot_unavailable' };
      }
      throw error;
    }
  },
};
