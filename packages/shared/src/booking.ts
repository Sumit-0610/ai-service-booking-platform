import { z } from 'zod';
import { pageParams, paginationMetaSchema } from './pagination.js';
import { priceQuoteSchema } from './pricing.js';

/**
 * Shared contracts for the booking workflow (Milestone 9).
 *
 * A customer books an available future slot for one of their own addresses. The
 * server derives everything else — the service, the technician, the scheduled
 * time, and the immutable price snapshot — from the slot and the pricing
 * service. The client never supplies a price, a status, a technician, or a
 * scheduled time.
 */

// ---------------------------------------------------------------------------
// Status lifecycle
// ---------------------------------------------------------------------------

export const bookingStatusValues = [
  'pending',
  'confirmed',
  'assigned',
  'in_progress',
  'completed',
  'cancelled',
  'rejected',
] as const;
export const bookingStatusSchema = z.enum(bookingStatusValues);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

/**
 * The documented state machine (see docs/domain-model.md). This is the single
 * source of truth; every status change in the API is checked against it.
 */
export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  pending: ['confirmed', 'rejected', 'cancelled'],
  confirmed: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'cancelled'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
  rejected: [],
};

export type BookingActor = 'customer' | 'operations' | 'technician';

/**
 * Which actor is allowed to drive which transition. A transition must be in
 * BOOKING_TRANSITIONS *and* permitted for the acting role. Milestone 9 only
 * wires the `customer` cancel transitions; `operations` and `technician` rows
 * are here for the milestones that add those endpoints (M10, M11).
 */
export const BOOKING_ACTOR_TRANSITIONS: Record<
  BookingActor,
  readonly (readonly [BookingStatus, BookingStatus])[]
> = {
  customer: [
    ['pending', 'cancelled'],
    ['confirmed', 'cancelled'],
    ['assigned', 'cancelled'],
  ],
  operations: [
    ['pending', 'confirmed'],
    ['pending', 'rejected'],
    ['confirmed', 'assigned'],
    ['confirmed', 'cancelled'],
    ['assigned', 'cancelled'],
  ],
  technician: [
    ['assigned', 'in_progress'],
    ['in_progress', 'completed'],
  ],
};

export function isValidBookingTransition(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

export function canActorTransition(
  actor: BookingActor,
  from: BookingStatus,
  to: BookingStatus,
): boolean {
  return (
    isValidBookingTransition(from, to) &&
    BOOKING_ACTOR_TRANSITIONS[actor].some(([f, t]) => f === from && t === to)
  );
}

/** Statuses from which a customer may cancel their own booking. */
export const CUSTOMER_CANCELLABLE_STATUSES: readonly BookingStatus[] = [
  'pending',
  'confirmed',
  'assigned',
];

export function isCustomerCancellable(status: BookingStatus): boolean {
  return CUSTOMER_CANCELLABLE_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Request contracts
// ---------------------------------------------------------------------------

/** cuid or seed-style id. */
export const bookingIdParamSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
});

const bookingRefSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{8,64}$/, 'Invalid identifier');

/**
 * The only fields a client may send when creating a booking. `.strict()` so any
 * of `customerId`, `technicianId`, `serviceId`, `status`, `scheduledStart`,
 * `price*`, etc. is a `422`, never silently accepted.
 */
export const createBookingSchema = z
  .object({
    slotId: bookingRefSchema,
    addressId: bookingRefSchema,
    customerNotes: z.string().trim().max(2000).optional(),
  })
  .strict();
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

// ---------------------------------------------------------------------------
// List queries (Milestone 12) — shared shape for the customer & technician lists
// ---------------------------------------------------------------------------

export const bookingListSortValues = [
  'created_desc',
  'created_asc',
  'scheduled_asc',
  'scheduled_desc',
] as const;
export const bookingListSortSchema = z.enum(bookingListSortValues).default('created_desc');
export type BookingListSort = z.infer<typeof bookingListSortSchema>;

/** `GET /api/v1/bookings` (customer) — filter by status, sort, page. Unknown
 * params are ignored; the server builds the Prisma `where` from this allow-list. */
export const customerBookingsQuerySchema = z.object({
  status: bookingStatusSchema.optional(),
  sort: bookingListSortSchema,
  ...pageParams({ defaultLimit: 10, maxLimit: 50 }),
});
export type CustomerBookingsQuery = z.infer<typeof customerBookingsQuerySchema>;
export type CustomerBookingsQueryInput = z.input<typeof customerBookingsQuerySchema>;

/** `GET /api/v1/technician/bookings` — same shape as the customer list. */
export const technicianJobsQuerySchema = customerBookingsQuerySchema;
export type TechnicianJobsQuery = CustomerBookingsQuery;

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

/** The frozen price snapshot — structurally identical to a pricing quote. */
export const bookingPriceSchema = priceQuoteSchema;
export type BookingPrice = z.infer<typeof bookingPriceSchema>;

const bookingServiceSchema = z.object({ slug: z.string(), name: z.string() });
const bookingAddressSchema = z.object({
  label: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
  country: z.string(),
});

/** What a customer sees for their own booking. No user ids, no raw model. */
export const bookingSchema = z.object({
  id: z.string(),
  status: bookingStatusSchema,
  service: bookingServiceSchema,
  address: bookingAddressSchema,
  scheduledStart: z.string(),
  scheduledEnd: z.string(),
  customerNotes: z.string().nullable(),
  price: bookingPriceSchema,
  createdAt: z.string(),
});
export type Booking = z.infer<typeof bookingSchema>;

export const bookingListSchema = z.object({
  items: z.array(bookingSchema),
  pagination: paginationMetaSchema,
});
export type BookingList = z.infer<typeof bookingListSchema>;

export const bookingResponseSchema = z.object({ booking: bookingSchema });
export type BookingResponse = z.infer<typeof bookingResponseSchema>;

/** One entry in a booking's status timeline. */
export const bookingStatusEventSchema = z.object({
  from: bookingStatusSchema.nullable(),
  to: bookingStatusSchema,
  reason: z.string().nullable(),
  at: z.string(),
});
export type BookingStatusEvent = z.infer<typeof bookingStatusEventSchema>;

export const bookingStatusHistorySchema = z.object({ items: z.array(bookingStatusEventSchema) });
export type BookingStatusHistory = z.infer<typeof bookingStatusHistorySchema>;

/** What the technician who owns the booked slot sees for that job. */
export const technicianBookingSchema = z.object({
  id: z.string(),
  status: bookingStatusSchema,
  service: bookingServiceSchema,
  customerName: z.string(),
  address: bookingAddressSchema,
  scheduledStart: z.string(),
  scheduledEnd: z.string(),
  customerNotes: z.string().nullable(),
  createdAt: z.string(),
});
export type TechnicianBooking = z.infer<typeof technicianBookingSchema>;

export const technicianBookingListSchema = z.object({
  items: z.array(technicianBookingSchema),
  pagination: paginationMetaSchema,
});
export type TechnicianBookingList = z.infer<typeof technicianBookingListSchema>;
