import {
  repositories,
  type OperationsBookingDetailRow,
  type OperationsBookingSummaryRow,
} from '@aisbp/database';
import {
  bookingPriceSchema,
  priceBreakdownSchema,
  type OperationsBooking,
  type OperationsBookingList,
  type OperationsBookingSummary,
  type OperationsBookingsQuery,
  type OperationsDashboard,
  type OperationsStatusEvent,
  type UpdateBookingStatusInput,
} from '@aisbp/shared';
import { AppError } from '../../lib/errors.js';

/**
 * Operations Dashboard domain service (Milestone 10). Maps repository rows to
 * the operations DTOs and translates repository outcomes to standard API
 * errors. Never touches Prisma directly; never trusts a client-supplied status,
 * price, or filter.
 */

function toSummary(row: OperationsBookingSummaryRow): OperationsBookingSummary {
  return {
    id: row.id,
    status: row.status,
    service: { slug: row.service.slug, name: row.service.name },
    customerName: row.customer.name,
    technicianName: row.technician?.displayName ?? null,
    scheduledStart: row.scheduledStart.toISOString(),
    scheduledEnd: row.scheduledEnd.toISOString(),
    totalCents: row.priceTotalCents,
    currency: row.priceCurrency,
    createdAt: row.createdAt.toISOString(),
  };
}

function toEvent(row: OperationsBookingDetailRow['statusHistory'][number]): OperationsStatusEvent {
  return {
    from: row.fromStatus,
    to: row.toStatus,
    reason: row.reason,
    by: row.changedBy?.name ?? null,
    byRole: row.changedBy?.role ?? null,
    at: row.createdAt.toISOString(),
  };
}

function toDetail(row: OperationsBookingDetailRow): OperationsBooking {
  return {
    id: row.id,
    status: row.status,
    service: { slug: row.service.slug, name: row.service.name },
    customerName: row.customer.name,
    customerEmail: row.customer.email,
    technicianName: row.technician?.displayName ?? null,
    address: {
      label: row.address.label,
      line1: row.address.line1,
      line2: row.address.line2,
      city: row.address.city,
      state: row.address.state,
      postalCode: row.address.postalCode,
      country: row.address.country,
    },
    scheduledStart: row.scheduledStart.toISOString(),
    scheduledEnd: row.scheduledEnd.toISOString(),
    customerNotes: row.customerNotes,
    price: bookingPriceSchema.parse({
      currency: row.priceCurrency,
      subtotalCents: row.priceSubtotalCents,
      feesTotalCents: row.priceFeesTotalCents,
      discountTotalCents: row.priceDiscountTotalCents,
      taxTotalCents: row.priceTaxTotalCents,
      totalCents: row.priceTotalCents,
      breakdown: priceBreakdownSchema.parse(row.priceBreakdown),
    }),
    statusHistory: row.statusHistory.map(toEvent),
    createdAt: row.createdAt.toISOString(),
  };
}

export const operationsService = {
  async dashboard(): Promise<OperationsDashboard> {
    const counts = await repositories.operations.dashboard();
    return {
      bookings: {
        total: counts.total,
        byStatus: counts.byStatus,
        active: counts.active,
        upcoming: counts.upcoming,
      },
      revenue: { byCurrency: counts.revenueByCurrency },
      technicians: counts.technicians,
    };
  },

  async listBookings(query: OperationsBookingsQuery): Promise<OperationsBookingList> {
    const skip = (query.page - 1) * query.limit;
    const { items, total } = await repositories.operations.searchBookings({
      status: query.status,
      q: query.q,
      from: query.from,
      to: query.to,
      sort: query.sort,
      skip,
      take: query.limit,
    });
    const totalPages = total === 0 ? 0 : Math.ceil(total / query.limit);
    return {
      items: items.map(toSummary),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPreviousPage: query.page > 1,
      },
    };
  },

  async getBooking(id: string): Promise<OperationsBooking> {
    const row = await repositories.operations.findBookingById(id);
    if (!row) {
      throw new AppError('NOT_FOUND', 'Booking not found');
    }
    return toDetail(row);
  },

  async changeBookingStatus(
    operatorUserId: string,
    id: string,
    input: UpdateBookingStatusInput,
  ): Promise<OperationsBooking> {
    const result = await repositories.operations.changeStatus(
      id,
      operatorUserId,
      input.status,
      input.reason ?? null,
    );
    switch (result.outcome) {
      case 'ok':
        return toDetail(result.booking);
      case 'not_found':
        throw new AppError('NOT_FOUND', 'Booking not found');
      case 'invalid_transition':
        throw new AppError('CONFLICT', `A ${result.from} booking cannot be set to ${input.status}`);
      case 'conflict':
        throw new AppError('CONFLICT', 'The booking status changed while you were updating it');
    }
  },
};
