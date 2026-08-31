import { describe, expect, it } from 'vitest';
import {
  addTechnicianServiceSchema,
  assignTechnicianSchema,
  operationsTechniciansQuerySchema,
  setTechnicianStatusSchema,
  technicianJobStatusSchema,
} from './technician.js';

describe('operationsTechniciansQuerySchema', () => {
  it('applies defaults and coerces the active flag', () => {
    expect(operationsTechniciansQuerySchema.parse({})).toMatchObject({ page: 1, limit: 20 });
    expect(operationsTechniciansQuerySchema.parse({ active: 'true' }).active).toBe(true);
    expect(operationsTechniciansQuerySchema.parse({ active: 'false' }).active).toBe(false);
    expect(operationsTechniciansQuerySchema.parse({ active: '' }).active).toBeUndefined();
  });

  it('bounds pagination and ignores unknown params', () => {
    expect(operationsTechniciansQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(operationsTechniciansQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    const parsed = operationsTechniciansQuerySchema.parse({ where: 'x' } as Record<
      string,
      unknown
    >);
    expect(parsed).not.toHaveProperty('where');
  });
});

describe('mutation bodies', () => {
  it('setTechnicianStatusSchema requires a boolean and nothing else', () => {
    expect(setTechnicianStatusSchema.parse({ active: false })).toEqual({ active: false });
    expect(setTechnicianStatusSchema.safeParse({ active: 'no' }).success).toBe(false);
    expect(setTechnicianStatusSchema.safeParse({ active: true, userId: 'x' }).success).toBe(false);
  });

  it('addTechnicianServiceSchema takes only a well-formed serviceId', () => {
    expect(
      addTechnicianServiceSchema.parse({ serviceId: 'seed-service-washing-machine' }).serviceId,
    ).toBe('seed-service-washing-machine');
    expect(addTechnicianServiceSchema.safeParse({ serviceId: 'bad id' }).success).toBe(false);
    expect(
      addTechnicianServiceSchema.safeParse({
        serviceId: 'clabc00000000000000000001',
        technicianId: 'x',
      }).success,
    ).toBe(false);
  });

  it('assignTechnicianSchema rejects mass-assignment fields', () => {
    expect(assignTechnicianSchema.parse({ technicianId: 'seed-technician-tara' })).toEqual({
      technicianId: 'seed-technician-tara',
    });
    for (const extra of [{ status: 'assigned' }, { slotId: 'x' }, { changedByUserId: 'y' }]) {
      expect(
        assignTechnicianSchema.safeParse({ technicianId: 'seed-technician-tara', ...extra })
          .success,
      ).toBe(false);
    }
  });

  it('technicianJobStatusSchema only allows in_progress / completed', () => {
    expect(technicianJobStatusSchema.parse({ status: 'in_progress' }).status).toBe('in_progress');
    expect(technicianJobStatusSchema.parse({ status: 'completed' }).status).toBe('completed');
    for (const status of ['assigned', 'confirmed', 'cancelled', 'pending']) {
      expect(technicianJobStatusSchema.safeParse({ status }).success, status).toBe(false);
    }
    expect(
      technicianJobStatusSchema.safeParse({ status: 'completed', technicianId: 'x' }).success,
    ).toBe(false);
  });
});
