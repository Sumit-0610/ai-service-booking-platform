import {
  repositories,
  type PublicSlotRow,
  type SlotWriteResult,
  type TechnicianSlotRow,
} from '@aisbp/database';
import {
  AVAILABILITY_DEFAULT_WINDOW_DAYS,
  AVAILABILITY_MAX_WINDOW_DAYS,
  checkSlotTimes,
  durationMinutes,
  type CreateSlotInput,
  type PublicAvailability,
  type PublicSlot,
  type TechnicianSlot,
  type UpdateSlotInput,
} from '@aisbp/shared';
import { AppError } from '../../lib/errors.js';

const DAY_MS = 86_400_000;

function toPublicSlot(row: PublicSlotRow): PublicSlot {
  return {
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    durationMinutes: durationMinutes(row.startsAt, row.endsAt),
  };
}

function toTechnicianSlot(row: TechnicianSlotRow): TechnicianSlot {
  return {
    id: row.id,
    service: { slug: row.service.slug, name: row.service.name },
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    durationMinutes: durationMinutes(row.startsAt, row.endsAt),
    status: row.status as TechnicianSlot['status'],
    booked: row.booking !== null,
  };
}

function validationDetail(field: string, message: string): unknown[] {
  return [{ path: field, message }];
}

function resolveWindow(
  from: Date | undefined,
  to: Date | undefined,
  now: Date,
): { from: Date; to: Date } {
  const start = from ?? now;
  const end = to ?? new Date(start.getTime() + AVAILABILITY_DEFAULT_WINDOW_DAYS * DAY_MS);

  if (end.getTime() <= start.getTime()) {
    throw new AppError('VALIDATION_ERROR', 'The "to" time must be after the "from" time');
  }
  if (end.getTime() - start.getTime() > AVAILABILITY_MAX_WINDOW_DAYS * DAY_MS) {
    throw new AppError(
      'VALIDATION_ERROR',
      `The availability window cannot exceed ${AVAILABILITY_MAX_WINDOW_DAYS} days`,
    );
  }
  return { from: start, to: end };
}

function mapWriteResult(result: SlotWriteResult): TechnicianSlot {
  switch (result.outcome) {
    case 'ok':
      return toTechnicianSlot(result.slot);
    case 'overlap':
      throw new AppError('CONFLICT', 'That time overlaps one of your existing availability slots');
    case 'invalid_time':
      throw new AppError(
        'VALIDATION_ERROR',
        'The end time must be after the start time',
        validationDetail('endsAt', 'The end time must be after the start time'),
      );
    case 'not_found':
      throw new AppError('NOT_FOUND', 'Availability slot not found');
  }
}

async function resolveActiveService(slug: string): Promise<string> {
  const service = await repositories.catalog.findActiveServiceBySlug(slug);
  if (!service) {
    throw new AppError(
      'VALIDATION_ERROR',
      'That service is not available',
      validationDetail('serviceSlug', 'Unknown or inactive service'),
    );
  }
  return service.id;
}

export const availabilityService = {
  async publicForService(
    slug: string,
    query: { from?: Date | undefined; to?: Date | undefined },
  ): Promise<PublicAvailability> {
    const service = await repositories.catalog.findActiveServiceBySlug(slug);
    if (!service) {
      throw new AppError('NOT_FOUND', 'Service not found');
    }

    const now = new Date();
    const window = resolveWindow(query.from, query.to, now);

    const rows = await repositories.availability.listPublicForService({
      serviceId: service.id,
      from: window.from,
      to: window.to,
      now,
    });

    return {
      items: rows.map(toPublicSlot),
      window: { from: window.from.toISOString(), to: window.to.toISOString() },
    };
  },

  async listForTechnician(technicianId: string): Promise<TechnicianSlot[]> {
    const now = new Date();
    const from = new Date(now.getTime() - DAY_MS);
    const to = new Date(now.getTime() + AVAILABILITY_MAX_WINDOW_DAYS * DAY_MS);

    const rows = await repositories.availability.listForTechnician({ technicianId, from, to });
    return rows.filter((row) => row.endsAt.getTime() >= now.getTime()).map(toTechnicianSlot);
  },

  async createForTechnician(technicianId: string, input: CreateSlotInput): Promise<TechnicianSlot> {
    const serviceId = await resolveActiveService(input.serviceSlug);
    const result = await repositories.availability.createForTechnician(technicianId, {
      serviceId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });
    return mapWriteResult(result);
  },

  async updateForTechnician(
    technicianId: string,
    id: string,
    input: UpdateSlotInput,
  ): Promise<TechnicianSlot> {
    const existing = await repositories.availability.findForTechnician(id, technicianId);
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Availability slot not found');
    }
    if (existing.booking) {
      throw new AppError('CONFLICT', 'This slot has a booking and can no longer be changed');
    }

    const patch: { serviceId?: string; startsAt?: Date; endsAt?: Date } = {};
    if (input.serviceSlug !== undefined) {
      patch.serviceId = await resolveActiveService(input.serviceSlug);
    }
    if (input.startsAt !== undefined) patch.startsAt = input.startsAt;
    if (input.endsAt !== undefined) patch.endsAt = input.endsAt;

    const effectiveStart = input.startsAt ?? existing.startsAt;
    const effectiveEnd = input.endsAt ?? existing.endsAt;
    const problem = checkSlotTimes(effectiveStart, effectiveEnd);
    if (problem) {
      throw new AppError(
        'VALIDATION_ERROR',
        problem.message,
        validationDetail(problem.field, problem.message),
      );
    }

    const result = await repositories.availability.updateForTechnician(id, technicianId, patch);
    return mapWriteResult(result);
  },

  async removeForTechnician(technicianId: string, id: string): Promise<void> {
    const result = await repositories.availability.deleteForTechnician(id, technicianId);
    if (result === 'not_found') {
      throw new AppError('NOT_FOUND', 'Availability slot not found');
    }
    if (result === 'in_use') {
      throw new AppError('CONFLICT', 'This slot has a booking and can no longer be deleted');
    }
  },
};
