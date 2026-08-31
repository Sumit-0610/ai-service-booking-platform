import {
  repositories,
  type BookingStatusEventRow,
  type CustomerBookingRow,
  type TechnicianBookingRow,
  type TechnicianJobRow,
} from '@aisbp/database';
import {
  bookingPriceSchema,
  priceBreakdownSchema,
  type Booking,
  type BookingStatusEvent,
  type CreateBookingInput,
  type TechnicianBooking,
  type TechnicianJob,
  type TechnicianJobStatusTarget,
} from '@aisbp/shared';
import { AppError } from '../../lib/errors.js';

/**
 * Booking workflow domain service. It maps repository rows to the public DTOs
 * and translates repository outcomes to the standard API errors. It never
 * touches Prisma directly and never trusts a client-supplied price, status,
 * technician, or scheduled time — those all come from the slot and the pricing
 * calculation inside the repository transaction.
 */

type AddressRow = CustomerBookingRow['address'];

function toAddress(row: AddressRow): Booking['address'] {
  return {
    label: row.label,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
  };
}

function toPrice(row: CustomerBookingRow): Booking['price'] {
  return bookingPriceSchema.parse({
    currency: row.priceCurrency,
    subtotalCents: row.priceSubtotalCents,
    feesTotalCents: row.priceFeesTotalCents,
    discountTotalCents: row.priceDiscountTotalCents,
    taxTotalCents: row.priceTaxTotalCents,
    totalCents: row.priceTotalCents,
    breakdown: priceBreakdownSchema.parse(row.priceBreakdown),
  });
}

function toBooking(row: CustomerBookingRow): Booking {
  return {
    id: row.id,
    status: row.status,
    service: { slug: row.service.slug, name: row.service.name },
    address: toAddress(row.address),
    scheduledStart: row.scheduledStart.toISOString(),
    scheduledEnd: row.scheduledEnd.toISOString(),
    customerNotes: row.customerNotes,
    price: toPrice(row),
    createdAt: row.createdAt.toISOString(),
  };
}

function toTechnicianBooking(row: TechnicianBookingRow): TechnicianBooking {
  return {
    id: row.id,
    status: row.status,
    service: { slug: row.service.slug, name: row.service.name },
    customerName: row.customer.name,
    address: toAddress(row.address),
    scheduledStart: row.scheduledStart.toISOString(),
    scheduledEnd: row.scheduledEnd.toISOString(),
    customerNotes: row.customerNotes,
    createdAt: row.createdAt.toISOString(),
  };
}

function toStatusEvent(row: BookingStatusEventRow): BookingStatusEvent {
  return {
    from: row.fromStatus,
    to: row.toStatus,
    reason: row.reason,
    at: row.createdAt.toISOString(),
  };
}

export const bookingService = {
  async createForCustomer(customerId: string, input: CreateBookingInput): Promise<Booking> {
    const result = await repositories.bookings.createForCustomer({
      customerId,
      slotId: input.slotId,
      addressId: input.addressId,
      customerNotes: input.customerNotes ?? null,
    });

    switch (result.outcome) {
      case 'ok':
        return toBooking(result.booking);
      case 'address_not_found':
        throw new AppError('VALIDATION_ERROR', 'That address could not be used', [
          { path: 'addressId', message: 'Unknown address' },
        ]);
      case 'slot_not_found':
        throw new AppError('VALIDATION_ERROR', 'That time slot could not be found', [
          { path: 'slotId', message: 'Unknown slot' },
        ]);
      case 'service_inactive':
        throw new AppError('VALIDATION_ERROR', 'That service is not available', [
          { path: 'slotId', message: 'The service for this slot is inactive' },
        ]);
      case 'slot_past':
        throw new AppError('VALIDATION_ERROR', 'That time slot is in the past', [
          { path: 'slotId', message: 'The slot has already started' },
        ]);
      case 'slot_unavailable':
        throw new AppError('CONFLICT', 'That time slot is no longer available');
    }
  },

  async listForCustomer(customerId: string): Promise<Booking[]> {
    const rows = await repositories.bookings.listForCustomer(customerId);
    return rows.map(toBooking);
  },

  async getForCustomer(customerId: string, id: string): Promise<Booking> {
    const row = await repositories.bookings.findForCustomer(id, customerId);
    if (!row) {
      throw new AppError('NOT_FOUND', 'Booking not found');
    }
    return toBooking(row);
  },

  async statusHistoryForCustomer(customerId: string, id: string): Promise<BookingStatusEvent[]> {
    const rows = await repositories.bookings.statusHistoryForCustomer(id, customerId);
    if (!rows) {
      throw new AppError('NOT_FOUND', 'Booking not found');
    }
    return rows.map(toStatusEvent);
  },

  async cancelForCustomer(customerId: string, id: string): Promise<Booking> {
    const result = await repositories.bookings.cancelForCustomer(id, customerId);
    switch (result.outcome) {
      case 'ok':
        return toBooking(result.booking);
      case 'not_found':
        throw new AppError('NOT_FOUND', 'Booking not found');
      case 'invalid_transition':
        throw new AppError('CONFLICT', `A ${result.from} booking can no longer be cancelled`);
      case 'conflict':
        throw new AppError('CONFLICT', 'The booking changed while you were cancelling it');
    }
  },

  async listForTechnician(technicianId: string): Promise<TechnicianBooking[]> {
    const rows = await repositories.bookings.listForTechnician(technicianId);
    return rows.map(toTechnicianBooking);
  },

  async getForTechnician(technicianId: string, id: string): Promise<TechnicianJob> {
    const row = await repositories.bookings.findJobForTechnician(id, technicianId);
    if (!row) {
      throw new AppError('NOT_FOUND', 'Booking not found');
    }
    return toTechnicianJob(row);
  },

  async changeJobStatusForTechnician(
    technicianId: string,
    technicianUserId: string,
    id: string,
    target: TechnicianJobStatusTarget,
  ): Promise<TechnicianJob> {
    const result = await repositories.bookings.changeJobStatusForTechnician(
      id,
      technicianId,
      technicianUserId,
      target,
    );
    switch (result.outcome) {
      case 'ok':
        return toTechnicianJob(result.booking);
      case 'not_found':
        throw new AppError('NOT_FOUND', 'Booking not found');
      case 'invalid_transition':
        throw new AppError('CONFLICT', `A ${result.from} job cannot be set to ${target}`);
      case 'conflict':
        throw new AppError('CONFLICT', 'The job status changed while you were updating it');
    }
  },
};

function toTechnicianJob(row: TechnicianJobRow): TechnicianJob {
  return {
    ...toTechnicianBooking(row),
    statusHistory: row.statusHistory.map(toStatusEvent),
  };
}
