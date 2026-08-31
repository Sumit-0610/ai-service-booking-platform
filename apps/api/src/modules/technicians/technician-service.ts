import {
  repositories,
  type OperationsBookingDetailRow,
  type OperationsTechnicianDetailRow,
  type OperationsTechnicianSummaryRow,
} from '@aisbp/database';
import {
  bookingPriceSchema,
  priceBreakdownSchema,
  type AssignableTechnician,
  type AssignTechnicianInput,
  type OperationsBooking,
  type OperationsStatusEvent,
  type OperationsTechnician,
  type OperationsTechnicianList,
  type OperationsTechnicianSummary,
  type OperationsTechniciansQuery,
  type TechnicianProfile,
} from '@aisbp/shared';
import { AppError } from '../../lib/errors.js';

/**
 * Technician management and assignment domain service (Milestone 11). Maps
 * repository rows to the shared DTOs and translates repository outcomes to
 * standard API errors. Never touches Prisma; never trusts a client-supplied
 * technician relationship, status, or history actor.
 */

function toSummary(row: OperationsTechnicianSummaryRow): OperationsTechnicianSummary {
  return {
    id: row.id,
    displayName: row.displayName,
    serviceArea: row.serviceArea,
    active: row.active,
    name: row.user.name,
    email: row.user.email,
    qualifiedServiceCount: row._count.qualifications,
    activeAssignmentCount: row.activeAssignmentCount,
  };
}

function toDetail(row: OperationsTechnicianDetailRow): OperationsTechnician {
  return {
    ...toSummary(row),
    qualifications: row.qualifications.map((q) => ({
      serviceId: q.service.id,
      slug: q.service.slug,
      name: q.service.name,
      active: q.service.active,
    })),
  };
}

// --- operations booking detail mapping (shared shape with the operations module) ---

function toOpsStatusEvent(
  row: OperationsBookingDetailRow['statusHistory'][number],
): OperationsStatusEvent {
  return {
    from: row.fromStatus,
    to: row.toStatus,
    reason: row.reason,
    by: row.changedBy?.name ?? null,
    byRole: row.changedBy?.role ?? null,
    at: row.createdAt.toISOString(),
  };
}

function toOpsBooking(row: OperationsBookingDetailRow): OperationsBooking {
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
    statusHistory: row.statusHistory.map(toOpsStatusEvent),
    createdAt: row.createdAt.toISOString(),
  };
}

export const technicianService = {
  // -------------------------------------------------------------------------
  // Operations: technician management
  // -------------------------------------------------------------------------

  async list(query: OperationsTechniciansQuery): Promise<OperationsTechnicianList> {
    const skip = (query.page - 1) * query.limit;
    const { items, total } = await repositories.technicians.listForOperations({
      active: query.active,
      q: query.q,
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

  async get(id: string): Promise<OperationsTechnician> {
    const row = await repositories.technicians.findByIdForOperations(id);
    if (!row) {
      throw new AppError('NOT_FOUND', 'Technician not found');
    }
    return toDetail(row);
  },

  async setActive(id: string, active: boolean): Promise<OperationsTechnician> {
    const result = await repositories.technicians.setActive(id, active);
    if (result === 'not_found') {
      throw new AppError('NOT_FOUND', 'Technician not found');
    }
    return this.get(id);
  },

  async addQualification(id: string, serviceId: string): Promise<OperationsTechnician> {
    const result = await repositories.technicians.addQualification(id, serviceId);
    switch (result.outcome) {
      case 'ok':
        return this.get(id);
      case 'technician_not_found':
        throw new AppError('NOT_FOUND', 'Technician not found');
      case 'service_not_found':
        throw new AppError('VALIDATION_ERROR', 'That service could not be found', [
          { path: 'serviceId', message: 'Unknown service' },
        ]);
      case 'service_inactive':
        throw new AppError('VALIDATION_ERROR', 'That service is not active', [
          { path: 'serviceId', message: 'Inactive service' },
        ]);
      case 'duplicate':
        throw new AppError('CONFLICT', 'The technician already has this qualification');
    }
  },

  async removeQualification(id: string, serviceId: string): Promise<OperationsTechnician> {
    const result = await repositories.technicians.removeQualification(id, serviceId);
    if (result === 'not_found') {
      throw new AppError('NOT_FOUND', 'Qualification not found');
    }
    return this.get(id);
  },

  // -------------------------------------------------------------------------
  // Operations: booking assignment
  // -------------------------------------------------------------------------

  async assignableForBooking(bookingId: string): Promise<AssignableTechnician[]> {
    const result = await repositories.operations.assignableForBooking(bookingId);
    if (result.outcome === 'not_found') {
      throw new AppError('NOT_FOUND', 'Booking not found');
    }
    return result.items;
  },

  async assignBooking(
    operatorUserId: string,
    bookingId: string,
    input: AssignTechnicianInput,
  ): Promise<OperationsBooking> {
    const result = await repositories.operations.assignTechnician(
      bookingId,
      operatorUserId,
      input.technicianId,
      input.reason ?? null,
    );
    switch (result.outcome) {
      case 'ok':
        return toOpsBooking(result.booking);
      case 'booking_not_found':
        throw new AppError('NOT_FOUND', 'Booking not found');
      case 'technician_not_found':
        throw new AppError('VALIDATION_ERROR', 'That technician could not be found', [
          { path: 'technicianId', message: 'Unknown technician' },
        ]);
      case 'technician_inactive':
        throw new AppError('VALIDATION_ERROR', 'That technician is inactive', [
          { path: 'technicianId', message: 'Inactive technician' },
        ]);
      case 'not_qualified':
        throw new AppError(
          'VALIDATION_ERROR',
          'That technician is not qualified for this service',
          [{ path: 'technicianId', message: 'Not qualified' }],
        );
      case 'invalid_state':
        throw new AppError(
          'CONFLICT',
          `A ${result.status} booking cannot be assigned to a technician`,
        );
      case 'already_assigned':
        throw new AppError('CONFLICT', 'That technician is already assigned to this booking');
      case 'schedule_conflict':
        throw new AppError('CONFLICT', 'That technician has another job at this time');
      case 'conflict':
        throw new AppError('CONFLICT', 'The booking changed while you were assigning it');
    }
  },

  // -------------------------------------------------------------------------
  // Technician: own read-only profile
  // -------------------------------------------------------------------------

  async profileForUser(userId: string): Promise<TechnicianProfile> {
    const row = await repositories.technicians.profileForUser(userId);
    if (!row) {
      throw new AppError('FORBIDDEN', 'This account has no technician profile');
    }
    return {
      displayName: row.displayName,
      serviceArea: row.serviceArea,
      active: row.active,
      qualifications: row.qualifications.map((q) => ({
        slug: q.service.slug,
        name: q.service.name,
      })),
    };
  },
};
