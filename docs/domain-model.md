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

- many addresses belong to one customer user
- bookings reference the address used at booking time

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

- `endsAt` must be after `startsAt`
- booking logic must prevent double-booking the same slot

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

## Deliberately Deferred Entities

The MVP should not start with a complex pricing rules engine, payment ledger, notification system, or multi-technician assignment model. These can be introduced only when a concrete requirement demands them.
