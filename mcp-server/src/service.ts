import { repositories, type McpAvailableSlotRow, type McpBookingDetailRow } from '@aisbp/database';
import {
  AVAILABILITY_PUBLIC_MAX_SLOTS,
  durationMinutes,
  priceBreakdownSchema,
} from '@aisbp/shared';
import type { Actor } from './context.js';
import { ToolError, validationDetail } from './errors.js';
import type {
  CancelOrRescheduleInput,
  CheckAvailabilityInput,
  CreateBookingInput,
  GetBookingDetailsInput,
} from './schemas.js';

/**
 * Booking-tool domain service — the MCP equivalent of
 * `apps/api/src/modules/bookings/booking-service.ts`. It maps repository rows to
 * plain JSON DTOs and repository outcomes to `ToolError`s, never imports Prisma,
 * never trusts a client-supplied price / status / technician / time, and reuses
 * `bookingRepository` for the create and cancel transactions.
 *
 * Every booking operation is scoped to the authenticated `Actor` (resolved once
 * at startup): the tools can only ever read or change that customer's bookings.
 */

const DAY_MS = 86_400_000;

interface SlotDto {
  slotId: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  technician: string;
  serviceArea: string;
}

function toSlotDto(row: McpAvailableSlotRow): SlotDto {
  return {
    slotId: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    durationMinutes: durationMinutes(row.startsAt, row.endsAt),
    technician: row.technician.displayName,
    serviceArea: row.technician.serviceArea,
  };
}

function toBookingDto(row: McpBookingDetailRow) {
  return {
    bookingId: row.id,
    status: row.status,
    service: { slug: row.service.slug, name: row.service.name },
    customerName: row.customer.name,
    customerEmail: row.customer.email,
    technician: row.technician?.displayName ?? null,
    serviceArea: row.technician?.serviceArea ?? null,
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
    price: {
      currency: row.priceCurrency,
      subtotalCents: row.priceSubtotalCents,
      feesTotalCents: row.priceFeesTotalCents,
      discountTotalCents: row.priceDiscountTotalCents,
      taxTotalCents: row.priceTaxTotalCents,
      totalCents: row.priceTotalCents,
      breakdown: priceBreakdownSchema.parse(row.priceBreakdown),
    },
    createdAt: row.createdAt.toISOString(),
    statusHistory: row.statusHistory.map((event) => ({
      from: event.fromStatus,
      to: event.toStatus,
      reason: event.reason,
      at: event.createdAt.toISOString(),
    })),
  };
}

async function resolveActiveService(serviceType: string) {
  const service = await repositories.mcp.findActiveServiceByTerm(serviceType);
  if (!service) {
    throw new ToolError(
      'NOT_FOUND',
      `No active service matches "${serviceType}"`,
      validationDetail('serviceType', 'Unknown or inactive service'),
    );
  }
  return service;
}

/**
 * Resolve which address to service. `bookingRepository.createForCustomer`
 * needs an `addressId`, but the tool signature has none — so:
 *  - an explicit `addressId` must be one the customer owns,
 *  - otherwise, if the customer has exactly one address, use it,
 *  - otherwise it is ambiguous: list the choices so the agent can retry.
 */
async function resolveAddressId(actor: Actor, explicit: string | undefined): Promise<string> {
  const addresses = await repositories.addresses.listByUser(actor.id);

  if (explicit) {
    const match = addresses.find((address) => address.id === explicit);
    if (!match) {
      throw new ToolError(
        'VALIDATION_ERROR',
        'That address does not belong to this customer',
        validationDetail('addressId', 'Unknown address'),
      );
    }
    return match.id;
  }

  if (addresses.length === 0) {
    throw new ToolError(
      'VALIDATION_ERROR',
      'This customer has no address on file; add one before booking',
      validationDetail('addressId', 'Customer has no address'),
    );
  }
  if (addresses.length > 1) {
    throw new ToolError(
      'VALIDATION_ERROR',
      'This customer has several addresses; pass addressId to choose one',
      addresses.map((address) => ({
        addressId: address.id,
        label: address.label,
        city: address.city,
      })),
    );
  }
  return addresses[0]!.id;
}

export const mcpService = {
  async checkAvailability(input: CheckAvailabilityInput) {
    const service = await resolveActiveService(input.serviceType);

    const dayStart = new Date(`${input.date}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const now = new Date();

    const rows = await repositories.mcp.listAvailableSlots({
      serviceId: service.id,
      from: dayStart,
      to: dayEnd,
      now,
      location: input.location,
      take: AVAILABILITY_PUBLIC_MAX_SLOTS,
    });

    return {
      service: { slug: service.slug, name: service.name },
      date: input.date,
      location: input.location ?? null,
      slotCount: rows.length,
      slots: rows.map(toSlotDto),
    };
  },

  async createBooking(actor: Actor, input: CreateBookingInput) {
    const service = await resolveActiveService(input.serviceType);

    const slot = await repositories.mcp.findSlotById(input.slot);
    if (!slot) {
      throw new ToolError('NOT_FOUND', 'That availability slot could not be found', [
        { path: 'slot', message: 'Unknown slot' },
      ]);
    }
    if (slot.service.slug !== service.slug) {
      throw new ToolError(
        'VALIDATION_ERROR',
        `That slot is for "${slot.service.name}", not "${service.name}"`,
        validationDetail('slot', 'Slot belongs to a different service'),
      );
    }

    const addressId = await resolveAddressId(actor, input.addressId);

    const result = await repositories.bookings.createForCustomer({
      customerId: actor.id,
      slotId: input.slot,
      addressId,
      customerNotes: null,
    });

    switch (result.outcome) {
      case 'ok':
        return this.getBookingDetails(actor, { bookingId: result.booking.id });
      case 'address_not_found':
        throw new ToolError('VALIDATION_ERROR', 'That address could not be used', [
          { path: 'addressId', message: 'Address no longer available' },
        ]);
      case 'slot_not_found':
        throw new ToolError('NOT_FOUND', 'That availability slot could not be found', [
          { path: 'slot', message: 'Unknown slot' },
        ]);
      case 'service_inactive':
        throw new ToolError('VALIDATION_ERROR', 'That service is not available', [
          { path: 'serviceType', message: 'The service for this slot is inactive' },
        ]);
      case 'slot_past':
        throw new ToolError('VALIDATION_ERROR', 'That time slot is in the past', [
          { path: 'slot', message: 'The slot has already started' },
        ]);
      case 'slot_unavailable':
        throw new ToolError('CONFLICT', 'That time slot is no longer available');
    }
  },

  async getBookingDetails(actor: Actor, input: GetBookingDetailsInput) {
    const row = await repositories.mcp.findBookingForCustomer(input.bookingId, actor.id);
    if (!row) {
      throw new ToolError('NOT_FOUND', 'Booking not found');
    }
    return toBookingDto(row);
  },

  async cancelOrReschedule(actor: Actor, input: CancelOrRescheduleInput) {
    if (input.action === 'cancel') {
      return this.cancel(actor, input.bookingId);
    }
    if (!input.newSlot) {
      // The schema already guarantees this; kept so the type narrows.
      throw new ToolError(
        'VALIDATION_ERROR',
        'newSlot is required when action is "reschedule"',
        validationDetail('newSlot', 'Missing new slot'),
      );
    }
    return this.reschedule(actor, input.bookingId, input.newSlot);
  },

  async cancel(actor: Actor, bookingId: string) {
    const result = await repositories.bookings.cancelForCustomer(bookingId, actor.id);
    switch (result.outcome) {
      case 'ok':
        return this.getBookingDetails(actor, { bookingId });
      case 'not_found':
        throw new ToolError('NOT_FOUND', 'Booking not found');
      case 'invalid_transition':
        throw new ToolError('CONFLICT', `A ${result.from} booking can no longer be cancelled`);
      case 'conflict':
        throw new ToolError('CONFLICT', 'The booking changed while it was being cancelled');
    }
  },

  async reschedule(actor: Actor, bookingId: string, newSlot: string) {
    const result = await repositories.mcp.rescheduleBooking(bookingId, actor.id, newSlot);
    switch (result.outcome) {
      case 'ok':
        return toBookingDto(result.booking);
      case 'booking_not_found':
        throw new ToolError('NOT_FOUND', 'Booking not found');
      case 'not_reschedulable':
        throw new ToolError(
          'CONFLICT',
          `A ${result.from} booking can no longer be rescheduled by the customer`,
        );
      case 'slot_not_found':
        throw new ToolError('NOT_FOUND', 'That availability slot could not be found', [
          { path: 'newSlot', message: 'Unknown slot' },
        ]);
      case 'service_mismatch':
        throw new ToolError(
          'VALIDATION_ERROR',
          'The new slot is for a different service than the booking',
          validationDetail('newSlot', 'Slot belongs to a different service'),
        );
      case 'slot_past':
        throw new ToolError('VALIDATION_ERROR', 'That time slot is in the past', [
          { path: 'newSlot', message: 'The slot has already started' },
        ]);
      case 'slot_unavailable':
        throw new ToolError('CONFLICT', 'That time slot is no longer available');
    }
  },
};
