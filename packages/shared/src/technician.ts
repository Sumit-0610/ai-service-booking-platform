import { z } from 'zod';
import { bookingStatusEventSchema, technicianBookingSchema } from './booking.js';

/**
 * Shared contracts for technician management and assignment (Milestone 11).
 *
 * Operations manages technician records, active status and service
 * qualifications, and assigns / reassigns a technician to a booking. A
 * technician sees and progresses only the jobs assigned to them. The client
 * never sends an owner id, a status the state machine forbids, or a
 * status-history actor.
 */

const refId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{8,64}$/, 'Invalid identifier');

export const technicianIdParamSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
});
export const technicianServiceParamSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  serviceId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
});

// ---------------------------------------------------------------------------
// Operations: technician list query
// ---------------------------------------------------------------------------

export const OPS_TECHNICIANS_PAGE_SIZE_DEFAULT = 20;
export const OPS_TECHNICIANS_PAGE_SIZE_MAX = 100;
export const OPS_TECHNICIANS_PAGE_MAX = 10_000;

const optionalText = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).max(100).optional(),
);

const optionalBool = z.preprocess(
  (value) =>
    value === '' || value === undefined
      ? undefined
      : value === 'true' || value === true
        ? true
        : value === 'false' || value === false
          ? false
          : value,
  z.boolean().optional(),
);

export const operationsTechniciansQuerySchema = z.object({
  active: optionalBool,
  q: optionalText,
  page: z.coerce.number().int().min(1).max(OPS_TECHNICIANS_PAGE_MAX).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(OPS_TECHNICIANS_PAGE_SIZE_MAX)
    .default(OPS_TECHNICIANS_PAGE_SIZE_DEFAULT),
});
export type OperationsTechniciansQuery = z.infer<typeof operationsTechniciansQuerySchema>;
export type OperationsTechniciansQueryInput = z.input<typeof operationsTechniciansQuerySchema>;

// ---------------------------------------------------------------------------
// Mutation bodies
// ---------------------------------------------------------------------------

export const setTechnicianStatusSchema = z.object({ active: z.boolean() }).strict();
export type SetTechnicianStatusInput = z.infer<typeof setTechnicianStatusSchema>;

export const addTechnicianServiceSchema = z.object({ serviceId: refId }).strict();
export type AddTechnicianServiceInput = z.infer<typeof addTechnicianServiceSchema>;

export const assignTechnicianSchema = z
  .object({
    technicianId: refId,
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type AssignTechnicianInput = z.infer<typeof assignTechnicianSchema>;

/** Statuses a technician may move their own job to (Milestone 11). */
export const technicianJobStatusTargets = ['in_progress', 'completed'] as const;
export const technicianJobStatusTargetSchema = z.enum(technicianJobStatusTargets);
export type TechnicianJobStatusTarget = z.infer<typeof technicianJobStatusTargetSchema>;

export const technicianJobStatusSchema = z
  .object({
    status: technicianJobStatusTargetSchema,
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type TechnicianJobStatusInput = z.infer<typeof technicianJobStatusSchema>;

// ---------------------------------------------------------------------------
// Response DTOs — operations
// ---------------------------------------------------------------------------

export const technicianQualificationSchema = z.object({
  serviceId: z.string(),
  slug: z.string(),
  name: z.string(),
  active: z.boolean(),
});
export type TechnicianQualification = z.infer<typeof technicianQualificationSchema>;

export const operationsTechnicianSummarySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  serviceArea: z.string(),
  active: z.boolean(),
  name: z.string(),
  email: z.string(),
  qualifiedServiceCount: z.number().int().nonnegative(),
  activeAssignmentCount: z.number().int().nonnegative(),
});
export type OperationsTechnicianSummary = z.infer<typeof operationsTechnicianSummarySchema>;

export const operationsTechnicianListSchema = z.object({
  items: z.array(operationsTechnicianSummarySchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
    hasNextPage: z.boolean(),
    hasPreviousPage: z.boolean(),
  }),
});
export type OperationsTechnicianList = z.infer<typeof operationsTechnicianListSchema>;

export const operationsTechnicianSchema = operationsTechnicianSummarySchema.extend({
  qualifications: z.array(technicianQualificationSchema),
});
export type OperationsTechnician = z.infer<typeof operationsTechnicianSchema>;

export const operationsTechnicianResponseSchema = z.object({
  technician: operationsTechnicianSchema,
});
export type OperationsTechnicianResponse = z.infer<typeof operationsTechnicianResponseSchema>;

/** A technician operations may pick when assigning a booking: already filtered
 * to active + qualified for the booking's service. `hasScheduleConflict` flags
 * an overlapping commitment so the UI can warn (the server also re-checks). */
export const assignableTechnicianSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  serviceArea: z.string(),
  hasScheduleConflict: z.boolean(),
});
export type AssignableTechnician = z.infer<typeof assignableTechnicianSchema>;

export const assignableTechniciansResponseSchema = z.object({
  items: z.array(assignableTechnicianSchema),
});
export type AssignableTechniciansResponse = z.infer<typeof assignableTechniciansResponseSchema>;

// ---------------------------------------------------------------------------
// Response DTOs — technician self
// ---------------------------------------------------------------------------

export const technicianProfileSchema = z.object({
  displayName: z.string(),
  serviceArea: z.string(),
  active: z.boolean(),
  qualifications: z.array(z.object({ slug: z.string(), name: z.string() })),
});
export type TechnicianProfile = z.infer<typeof technicianProfileSchema>;

export const technicianProfileResponseSchema = z.object({ profile: technicianProfileSchema });
export type TechnicianProfileResponse = z.infer<typeof technicianProfileResponseSchema>;

/** A technician's job detail = the M9 job summary plus its status timeline. */
export const technicianJobSchema = technicianBookingSchema.extend({
  statusHistory: z.array(bookingStatusEventSchema),
});
export type TechnicianJob = z.infer<typeof technicianJobSchema>;

export const technicianJobResponseSchema = z.object({ booking: technicianJobSchema });
export type TechnicianJobResponse = z.infer<typeof technicianJobResponseSchema>;
