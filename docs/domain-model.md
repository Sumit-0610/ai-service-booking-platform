# Domain Model And Database Design

## Core Actors

- Customer: selects services, manages addresses, books appointments, tracks history, modifies or cancels eligible bookings.
- Operations/Admin: manages the operational queue, technicians, assignments, booking status, and metrics.
- Technician: views assigned work, sees booking details, updates job progress, and marks work completed.

## Core Entities

### User

Represents an authenticated identity.

Important fields:

- `id`
- `email`
- `passwordHash`
- `name`
- `role`: `customer`, `operations`, or `technician`
- `createdAt`
- `updatedAt`

Indexes:

- unique `email`
- `role` for operations screens if needed

### Address

Customer-owned service location.

Important fields:

- `id`
- `userId`
- `label`
- `line1`
- `line2`
- `city`
- `state`
- `postalCode`
- `country`
- `createdAt`
- `updatedAt`

Relationships:

- many addresses belong to one customer user (cascade-deleted with the user)
- bookings reference the address used at booking time (`onDelete: Restrict` —
  an address in use by a booking cannot be deleted)

Notes (Milestone 6):

- The model is international. `postalCode` has no country-specific format check;
  `country` is an ISO 3166-1 alpha-2 code.
- There is no default-address flag and no recipient-name / phone field. Neither
  is required by the booking workflow; see [Database](database.md).

### ServiceCategory

Groups bookable services.

Important fields:

- `id`
- `name`
- `slug`
- `description`
- `active`

Indexes:

- unique `slug`
- `active`

### Service

A bookable home/service installation offering.

Important fields:

- `id`
- `categoryId`
- `name`
- `slug`
- `description`
- `basePrice`
- `estimatedDurationMinutes`
- `active`
- `createdAt`
- `updatedAt`

Indexes:

- unique `slug`
- `categoryId`
- `active`
- searchable fields as needed by the chosen database strategy

Notes (Milestone 8):

- `basePriceCents` (integer minor units) + `currency` are the **authoritative
  current price**. The pricing service turns them into a `PriceQuote`
  (`subtotal = basePriceCents`; `fees = discount = tax = 0`;
  `total = subtotal + fees + tax - discount`). No fee/tax/discount/coupon rules
  exist; the zero components are structural. No currency conversion.
- A `PriceQuote` is a live read. The immutable price snapshot on `Booking` is
  written only at booking creation (Milestone 9), never by the pricing service.

### Technician

Operational worker profile linked to a user account.

Important fields:

- `id`
- `userId`
- `displayName`
- `active`
- `serviceArea`
- `createdAt`
- `updatedAt`

Indexes:

- unique `userId`
- `active`

### TechnicianService (Milestone 11)

The technician ↔ service qualification join. Deferred at Milestone 7, added here
because assignment must reject a technician who is not qualified for a booking's
service.

Important fields:

- `id`
- `technicianId`
- `serviceId`
- `createdAt`

Constraints / indexes:

- `@@unique(technicianId, serviceId)` — the database prevents a duplicate
  qualification.
- `@@index(serviceId)` — "who can do service X?" for the assignment picker.
- Both foreign keys are `onDelete: Cascade` (a removed technician or service
  drops its qualification rows). Removing a `TechnicianService` row **never**
  affects existing bookings — `Booking.serviceId` and `Booking.technicianId` are
  independent columns.

Operations manages these rows; there is no self-service. A technician is not
required to have a matching qualification to _create an availability slot_ (that
check stays as it was in M7) — the qualification gate applies to _assignment_.

### AvailabilitySlot

A time window where a technician can perform a service.

Important fields:

- `id`
- `technicianId`
- `serviceId`
- `startsAt`
- `endsAt`
- `status`: `available`, `held`, `booked`, `unavailable`
- `createdAt`
- `updatedAt`

Indexes:

- `technicianId`, `startsAt`
- `serviceId`, `startsAt`
- `status`, `startsAt`

Constraints:

- `endsAt` must be after `startsAt` (CHECK)
- a technician's slots may never overlap in time — enforced by a PostgreSQL
  GiST exclusion constraint, not application code. Adjacent slots are allowed.

Notes (Milestone 7):

- A technician may still create an availability slot for **any active service**
  (unchanged). The `TechnicianService` qualification model added in Milestone 11
  gates **assignment**, not slot creation; tightening slot creation to require a
  qualification is a small, separate follow-up.
- `status` is system-managed. The technician API creates slots as `available`
  and does not accept a client-supplied `status`.
- Timestamps are UTC instants (`timestamptz`); the API is ISO 8601 with an
  explicit offset on input and `Z` on output.

### Booking

The central customer booking/job record.

Important fields:

- `id`
- `customerId`
- `addressId`
- `serviceId`
- `technicianId`, nullable until assignment
- `slotId`
- `status`: `pending`, `confirmed`, `assigned`, `in_progress`, `completed`, `cancelled`, `rejected`
- `scheduledStart`
- `scheduledEnd`
- `customerNotes`
- `priceCurrency`
- `priceSubtotal`
- `priceFeesTotal`
- `priceDiscountTotal`
- `priceTaxTotal`
- `priceTotal`
- `priceBreakdown`
- `createdAt`
- `updatedAt`

Pricing requirement:

- Booking stores the final agreed price and breakdown at the time of confirmation or creation.
- Historical booking prices must not change when `Service.basePrice` changes later.
- `priceBreakdown` should be structured JSON for simple MVP line items, not a complex rules engine.

Indexes:

- `customerId`, `createdAt`
- `technicianId`, `scheduledStart`
- `serviceId`
- `status`
- `scheduledStart`

### BookingStatusHistory

Immutable timeline of booking lifecycle changes.

Important fields:

- `id`
- `bookingId`
- `fromStatus`, nullable for initial event
- `toStatus`
- `changedByUserId`
- `reason`
- `createdAt`

Indexes:

- `bookingId`, `createdAt`
- `changedByUserId`

## Relationships

```txt
User 1 -> many Address
User 1 -> optional Technician
User(customer) 1 -> many Booking
ServiceCategory 1 -> many Service
Service 1 -> many AvailabilitySlot
Service 1 -> many Booking
Technician * <-> * Service   (via TechnicianService — qualifications)
Technician 1 -> many AvailabilitySlot
Technician 1 -> many Booking
AvailabilitySlot 1 -> optional Booking
Booking 1 -> many BookingStatusHistory
Address 1 -> many Booking
```

## Booking State Machine

Allowed states:

```txt
pending
confirmed
assigned
in_progress
completed
cancelled
rejected
```

Expected transitions:

```txt
pending -> confirmed
pending -> rejected
pending -> cancelled
confirmed -> assigned
confirmed -> cancelled
assigned -> in_progress
assigned -> cancelled
in_progress -> completed
```

Every transition must be performed by the booking service and recorded in `BookingStatusHistory`.

Notes (Milestone 9):

- A booking is **created as `pending`** by the customer for one of their own
  addresses on an available future slot. `technicianId` is copied from the slot
  at creation (booking a technician's slot books that technician's time); this
  is not the operations "assignment" step, which — with technician profile
  management and the job-status flow — is Milestone 11.
- The only transition wired in M9 is **customer cancellation**
  (`pending | confirmed | assigned -> cancelled`). `pending -> confirmed`,
  `-> assigned`, `-> in_progress`, `-> completed`, `-> rejected` have no actor
  yet; operations (M10) and technician (M11) endpoints will drive them. The full
  actor-gated transition table lives in `@aisbp/shared` (`booking.ts`).
- The price snapshot is written once, inside the creation transaction, from the
  pricing calculation. It is never recomputed. Booking **modification /
  reschedule is not implemented** in M9.

Notes (Milestone 10):

- Operations drives the triage transitions that need no technician:
  `pending -> confirmed`, `pending -> rejected`, `confirmed -> cancelled`.
  Each is enforced against the same shared state machine and recorded in
  `BookingStatusHistory` with the operator as `changedByUserId`.
  `pending -> cancelled` stays a customer-only transition.
- `confirmed -> assigned` and everything downstream (`in_progress`, `completed`)
  require technician assignment and remain Milestone 11.
- The operations booking DTOs are read-derived; no operations action recomputes
  or overwrites the immutable price snapshot.

Notes (Milestone 11):

- **Assignment** (`confirmed -> assigned`) is a dedicated operations operation,
  not part of the generic status endpoint, because it needs a valid technician.
  It changes `Booking.technicianId` and keeps the existing slot. **Reassignment**
  moves a booking already in `assigned` to another technician (status unchanged);
  it is not allowed once work has started (`in_progress` / `completed`).
- **Technician job flow** — the assigned technician drives
  `assigned -> in_progress -> completed`, recorded with their user id. A
  technician can only act on a booking whose `technicianId` matches their own
  `Technician.id`.
- Assignment / reassignment / job-status changes are transactional and never
  recompute the price snapshot. Concurrency is handled by a `FOR UPDATE` lock on
  the target `Technician` plus conditional updates on the `Booking` row; a
  concurrent conflict returns `409`, never an inconsistent booking.
- An **inactive** technician cannot be newly assigned but may finish jobs already
  assigned to them.

## Deliberately Deferred Entities

The MVP should not start with a complex pricing rules engine, payment ledger, notification system, or multi-technician assignment model. These can be introduced only when a concrete requirement demands them.

## Caching And The Source Of Truth (Milestone 13)

The Redis cache introduced in Milestone 13 holds only short-lived copies of the
public catalogue DTOs (`ServiceCategory`, `Service` lists and detail). It is not
a domain entity and never an authority. Every stateful decision — a booking's
status and price snapshot, a slot's availability, a technician's assignment and
qualifications, resource ownership — is read from PostgreSQL. If Redis is
unavailable the platform behaves exactly as before, only with more database
reads on the catalogue path.
