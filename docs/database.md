# Database

The database foundation lives in the `@aisbp/database` workspace package
(`packages/database`). It owns the Prisma schema, migrations, seed script, the
generated Prisma client, and the data-access layer. No other package talks to
PostgreSQL directly.

## Technology

- PostgreSQL 16 (via the existing `docker-compose.yml` service)
- Prisma 6 (`prisma-client-js` generator, client generated to
  `packages/database/generated/prisma`, which is git-ignored)
- TypeScript, pnpm workspace

Prisma 7 was evaluated and deferred: its new `prisma.config.ts` model and
driver-adapter-by-default add setup surface without an MVP benefit. Prisma 6.19
is the current stable 6.x line and is trivial to explain.

## Access layer

The intended runtime path is:

```txt
Controller -> Service -> Repository (@aisbp/database) -> Prisma -> PostgreSQL
```

- `src/client.ts` holds the single `PrismaClient`. It is internal to the
  package and is never exported.
- `src/repositories/*` is the sanctioned data-access surface. Only the queries
  needed by this milestone exist so far (`catalogRepository`: list active
  categories, list active services, find a service by slug).
- `src/index.ts` is the package's public API: `repositories`,
  `connectDatabase` / `disconnectDatabase`, and the Prisma-generated row types
  and enums (`Role`, `BookingStatus`, `AvailabilitySlotStatus`).

Application code imports from `@aisbp/database`, never from the generated client.

## Conventions

- **Money** is stored as integer minor units (`Int`, `...Cents`). No floating
  point, no `Decimal` serialization concerns.
- **Instants** use `timestamptz` (`@db.Timestamptz(3)`) so scheduling math is
  timezone-safe.
- **IDs** are `cuid()` strings.
- **Enums** use the exact tokens from the domain docs and the API contract
  (`pending`, `in_progress`, `customer`, …) so there is no translation layer
  between the database and the API.
- Every table has `createdAt`; every mutable table has `updatedAt`.
  `BookingStatusHistory` is append-only and has only `createdAt`.

## Entities

| Entity                 | Purpose                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| `User`                 | Authenticated identity. `role` is `customer` / `operations` / `technician`. |
| `Address`              | Customer-owned service location. Cascade-deleted with the user.             |
| `ServiceCategory`      | Groups bookable services.                                                   |
| `Service`              | A bookable offering with a current `basePriceCents`.                        |
| `Technician`           | Operational worker profile, 1:1 with a `User`.                              |
| `AvailabilitySlot`     | A time window a technician can perform a service.                           |
| `Booking`              | Central booking/job record. Holds its own price snapshot.                   |
| `BookingStatusHistory` | Append-only audit of every booking status change.                           |

### Relationships

```txt
User 1  -> * Address
User 1  -> 0..1 Technician
User 1  -> * Booking            (as customer)
User 1  -> * BookingStatusHistory (as the actor who changed status)
ServiceCategory 1 -> * Service
Service 1 -> * AvailabilitySlot
Service 1 -> * Booking
Technician 1 -> * AvailabilitySlot
Technician 1 -> * Booking
AvailabilitySlot 1 -> 0..1 Booking
Booking 1 -> * BookingStatusHistory
Address 1 -> * Booking
```

### Referential actions

- `Address`, `Technician` are `Cascade`-deleted with their `User`.
- `Booking` uses `Restrict` for `customer`, `address`, `service`, and `slot`
  (you cannot delete something a booking still points at) and `SetNull` for
  `technician` (a booking survives a technician being removed).
- `BookingStatusHistory` is `Cascade`-deleted with its `Booking`.

## Constraints and indexes

Prisma-level:

- Unique: `User.email`, `ServiceCategory.slug`, `Service.slug`,
  `Technician.userId`, `Booking.slotId`,
  `AvailabilitySlot(technicianId, serviceId, startsAt)` (exact-duplicate guard).
- Indexes: `User(role)`, `Address(userId)`, `ServiceCategory(active)`,
  `Service(categoryId)`, `Service(active)`, `Technician(active)`,
  `AvailabilitySlot(technicianId, startsAt)`,
  `AvailabilitySlot(serviceId, startsAt)`,
  `AvailabilitySlot(status, startsAt)`,
  `Booking(customerId, createdAt)`, `Booking(technicianId, scheduledStart)`,
  `Booking(serviceId)`, `Booking(status)`, `Booking(scheduledStart)`,
  `BookingStatusHistory(bookingId, createdAt)`,
  `BookingStatusHistory(changedByUserId)`.

Added in the initial migration as raw SQL (Prisma has no schema syntax for
these), and covered by integration tests:

- `btree_gist` extension.
- `AvailabilitySlot` `CHECK (endsAt > startsAt)`.
- `AvailabilitySlot` `EXCLUDE USING gist (technicianId WITH =, tstzrange(startsAt, endsAt) WITH &&)`
  — a technician can never have two overlapping slots.
- `Booking` `CHECK (scheduledEnd > scheduledStart)`.
- `Booking` `CHECK` that all price components and the total are `>= 0`.
- `Booking` `CHECK (priceTotalCents = priceSubtotalCents + priceFeesTotalCents + priceTaxTotalCents - priceDiscountTotalCents)`
  — the stored snapshot is always internally consistent.
- `Service` `CHECK (basePriceCents >= 0)` and `CHECK (estimatedDurationMinutes > 0)`.

### Index review — catalogue (Milestone 5)

The public catalogue queries filter on `Service.active` (always), optionally join
`ServiceCategory` by its unique `slug` and filter on `categoryId`, and sort by
`name` / `basePriceCents` / `createdAt`.

- The existing `Service(active)` and `Service(categoryId)` single-column indexes
  and the unique `ServiceCategory(slug)` index already cover every filter/join
  predicate.
- Sorting is not indexed. With a small catalogue this is a cheap in-memory sort,
  and the [performance strategy](performance.md) requires measuring with query
  plans before adding an index. **No new index was added.**
- Case-insensitive `q` search uses `ILIKE '%term%'`, which no btree index can
  serve; a `pg_trgm` GIN index would help at scale but is out of scope for the
  MVP and would be added only against a measured need.

No migration was needed for Milestone 5.

### Address management (Milestone 6)

- **No schema change, no migration.** The existing `Address` model
  (`label, line1, line2?, city, state, postalCode, country` + `userId`,
  timestamps) is sufficient.
- **No `isDefault` / default-address concept.** It does not exist in the schema
  and is not required to build the booking workflow — a booking will reference
  an address the customer picks. Adding a "default" would mean a new column plus
  a "exactly one default per user" invariant for no MVP benefit. Deferred.
- **No recipient-name / phone fields.** Not in the approved model; not added.
  If the booking workflow needs an on-site contact, that is a deliberate
  decision in that milestone with its own migration.
- **Index review**: the customer address list is
  `where: { userId }` ordered by `createdAt`. The existing `Address(userId)`
  index covers it, and a customer's list is expected to be tiny. No new index.
- **Deletion**: `Booking.address` is `onDelete: Restrict`, so PostgreSQL refuses
  to delete an address a booking still references; the API surfaces this as
  `409 CONFLICT`. Historical booking records keep their address.

### Availability & scheduling (Milestone 7)

- **No schema change, no migration.** `AvailabilitySlot` and its constraints
  (added in the initial migration) are unchanged. The exclusion constraint
  `availability_slot_no_overlap` and the `endsAt > startsAt` CHECK are **not
  weakened or removed**.
- **Index review** against the two query shapes:
  - Public availability — `WHERE serviceId = ? AND status = 'available' AND
startsAt IN [from, to)` ordered by `startsAt`. Served by the existing
    `AvailabilitySlot(serviceId, startsAt)` index (equality + range + sort).
  - Technician's own list — `WHERE technicianId = ? AND startsAt IN [from, to)`
    ordered by `startsAt`. Served by `AvailabilitySlot(technicianId, startsAt)`.
  - `status`/time filtering is covered by `AvailabilitySlot(status, startsAt)`.
    No new index was added — the existing three cover every predicate and sort.
- **Technician ↔ service**: the schema has **no** technician-service
  qualification model (no join table, no `Technician.services`). The only link
  is a row in `AvailabilitySlot(technicianId, serviceId)`. So in Milestone 7 a
  technician may create availability for **any active service**. A
  `TechnicianService` join is the natural future addition when operations needs
  to gate which technicians can offer which services — it was not invented here.
- Ownership: availability is keyed by `Technician.id`, resolved from the
  authenticated `User.id` via the unique `Technician.userId`.

## Pricing snapshot

`Service.basePriceCents` is the _current_ list price. When a booking is created
the agreed price is copied onto the booking:

```txt
priceCurrency, priceSubtotalCents, priceFeesTotalCents,
priceDiscountTotalCents, priceTaxTotalCents, priceTotalCents, priceBreakdown (JSON)
```

Nothing recomputes these from `Service` afterwards. Repricing a service has no
effect on existing bookings — verified by
`packages/database/src/__tests__/database.integration.test.ts`.

`priceBreakdown` is a small structured JSON blob for display, for example:

```json
{ "lines": [{ "label": "Washing machine installation", "amountCents": 8900 }] }
```

It is intentionally not a rules engine.

## Migrations

The initial migration is `packages/database/prisma/migrations/*_init`. It is
reproducible from an empty database:

```bash
docker compose up -d postgres
pnpm --filter @aisbp/database db:migrate:deploy
```

CI runs exactly this against a fresh `postgres:16` service container on every
push and pull request.

To evolve the schema during development:

```bash
pnpm --filter @aisbp/database db:migrate   # prisma migrate dev
```

## Seed

```bash
pnpm --filter @aisbp/database db:seed
```

Deterministic and safe to re-run. It creates: five users (two customers, one
operations, two technicians), three customer addresses (Indian demo data),
three service categories,
fourteen services (thirteen active plus one inactive, to exercise catalogue
filtering), two technicians, and one week of upcoming, non-overlapping
availability slots. Every seeded account has the development password
`aisbp-dev-password`. There is no seeded booking data and no fabricated metrics,
ratings, or reviews.

`pnpm --filter @aisbp/database db:reset` drops the database, re-applies
migrations, and re-seeds.

## Tests

`pnpm --filter @aisbp/database test` runs:

- `enums.test.ts` — no database; locks the generated enums to the documented
  tokens.
- `database.integration.test.ts` — requires a migrated, seeded database at
  `DATABASE_URL`; exercises the repository layer, unique constraints, the slot
  overlap/ordering constraints, and pricing-snapshot independence.
