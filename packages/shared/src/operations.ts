import { z } from 'zod';
import { bookingStatusSchema, type BookingStatus } from './booking.js';
import { pageParams, paginationMetaSchema } from './pagination.js';
import { priceQuoteSchema } from './pricing.js';

/**
 * Shared contracts for the Operations Dashboard (Milestone 10).
 *
 * Operations is a read-and-triage surface: operators see every booking, page
 * and filter the queue, open a booking's full detail, and move a booking
 * through the operations transitions that need no technician
 * (`pending -> confirmed`, `pending -> rejected`, `confirmed -> cancelled`).
 * Technician assignment and profile management stay in Milestone 11.
 *
 * All money is integer minor units. The client never sends a price, an owner
 * id, a raw filter, or a status the state machine does not permit.
 */

// ---------------------------------------------------------------------------
// Booking queue query
// ---------------------------------------------------------------------------

export const OPS_BOOKINGS_PAGE_SIZE_DEFAULT = 20;
export const OPS_BOOKINGS_PAGE_SIZE_MAX = 100;
export const OPS_BOOKINGS_QUERY_MAX_LENGTH = 100;

export const operationsBookingSortValues = [
  'created_desc',
  'created_asc',
  'scheduled_asc',
  'scheduled_desc',
] as const;
export const operationsBookingSortSchema = z
  .enum(operationsBookingSortValues)
  .default('created_desc');
export type OperationsBookingSort = z.infer<typeof operationsBookingSortSchema>;

const optionalText = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).max(OPS_BOOKINGS_QUERY_MAX_LENGTH).optional(),
);

const optionalInstant = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value))
    .optional(),
);

/**
 * Query for `GET /api/v1/operations/bookings`. Unknown parameters are ignored;
 * the server builds the Prisma `where` from this allow-list only.
 */
export const operationsBookingsQuerySchema = z.object({
  status: bookingStatusSchema.optional(),
  q: optionalText,
  from: optionalInstant,
  to: optionalInstant,
  sort: operationsBookingSortSchema,
  ...pageParams({
    defaultLimit: OPS_BOOKINGS_PAGE_SIZE_DEFAULT,
    maxLimit: OPS_BOOKINGS_PAGE_SIZE_MAX,
  }),
});
export type OperationsBookingsQuery = z.infer<typeof operationsBookingsQuerySchema>;
export type OperationsBookingsQueryInput = z.input<typeof operationsBookingsQuerySchema>;

export const operationsBookingIdParamSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
});

// ---------------------------------------------------------------------------
// Status change
// ---------------------------------------------------------------------------

/** Target statuses an operator may set in Milestone 10 (no assignment). */
export const operationsStatusTargets = ['confirmed', 'rejected', 'cancelled'] as const;
export const operationsStatusTargetSchema = z.enum(operationsStatusTargets);
export type OperationsStatusTarget = z.infer<typeof operationsStatusTargetSchema>;

export const updateBookingStatusSchema = z
  .object({
    status: operationsStatusTargetSchema,
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type UpdateBookingStatusInput = z.infer<typeof updateBookingStatusSchema>;

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

const opsBookingServiceSchema = z.object({ slug: z.string(), name: z.string() });

export const operationsBookingSummarySchema = z.object({
  id: z.string(),
  status: bookingStatusSchema,
  service: opsBookingServiceSchema,
  customerName: z.string(),
  technicianName: z.string().nullable(),
  scheduledStart: z.string(),
  scheduledEnd: z.string(),
  totalCents: z.number().int().nonnegative(),
  currency: z.string(),
  createdAt: z.string(),
});
export type OperationsBookingSummary = z.infer<typeof operationsBookingSummarySchema>;

export const operationsBookingListSchema = z.object({
  items: z.array(operationsBookingSummarySchema),
  pagination: paginationMetaSchema,
});
export type OperationsBookingList = z.infer<typeof operationsBookingListSchema>;

export const operationsStatusEventSchema = z.object({
  from: bookingStatusSchema.nullable(),
  to: bookingStatusSchema,
  reason: z.string().nullable(),
  by: z.string().nullable(),
  byRole: z.enum(['customer', 'operations', 'technician']).nullable(),
  at: z.string(),
});
export type OperationsStatusEvent = z.infer<typeof operationsStatusEventSchema>;

/** The full operations view of one booking. Operators legitimately see the
 * customer's contact details and the price snapshot; never a password hash,
 * session data, or raw database internals. */
export const operationsBookingSchema = z.object({
  id: z.string(),
  status: bookingStatusSchema,
  service: opsBookingServiceSchema,
  customerName: z.string(),
  customerEmail: z.string(),
  technicianName: z.string().nullable(),
  address: z.object({
    label: z.string(),
    line1: z.string(),
    line2: z.string().nullable(),
    city: z.string(),
    state: z.string(),
    postalCode: z.string(),
    country: z.string(),
  }),
  scheduledStart: z.string(),
  scheduledEnd: z.string(),
  customerNotes: z.string().nullable(),
  price: priceQuoteSchema,
  statusHistory: z.array(operationsStatusEventSchema),
  createdAt: z.string(),
});
export type OperationsBooking = z.infer<typeof operationsBookingSchema>;

export const operationsBookingResponseSchema = z.object({ booking: operationsBookingSchema });
export type OperationsBookingResponse = z.infer<typeof operationsBookingResponseSchema>;

// ---------------------------------------------------------------------------
// Dashboard metrics
// ---------------------------------------------------------------------------

/**
 * Counting semantics (all derived from live database state):
 * - `bookings.total`  : every booking row.
 * - `bookings.byStatus`: booking rows grouped by `status` (all time).
 * - `bookings.active`  : status in pending | confirmed | assigned | in_progress.
 * - `bookings.upcoming`: `active` set **and** `scheduledStart >= now`.
 * - `revenue.byCurrency[].committedTotalCents`: sum of `priceTotalCents` for
 *   bookings whose status is **not** cancelled or rejected, grouped by the
 *   booking's own `priceCurrency` (snapshots are never mixed within a booking).
 * - `technicians.total` / `.active`: `Technician` rows / those with `active`.
 */
export const operationsDashboardSchema = z.object({
  bookings: z.object({
    total: z.number().int().nonnegative(),
    byStatus: z.record(bookingStatusSchema, z.number().int().nonnegative()),
    active: z.number().int().nonnegative(),
    upcoming: z.number().int().nonnegative(),
  }),
  revenue: z.object({
    byCurrency: z.array(
      z.object({
        currency: z.string(),
        committedTotalCents: z.number().int().nonnegative(),
      }),
    ),
  }),
  technicians: z.object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
  }),
});
export type OperationsDashboard = z.infer<typeof operationsDashboardSchema>;

export const operationsDashboardResponseSchema = z.object({
  dashboard: operationsDashboardSchema,
});
export type OperationsDashboardResponse = z.infer<typeof operationsDashboardResponseSchema>;

/** Statuses that count as "active" work for the dashboard. */
export const ACTIVE_BOOKING_STATUSES: readonly BookingStatus[] = [
  'pending',
  'confirmed',
  'assigned',
  'in_progress',
];
