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
| `TechnicianService`    | Technician ↔ service qualification join (Milestone 11).                     |
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
Technician * <-> * Service      (via TechnicianService)
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
- `TechnicianService` is `Cascade`-deleted with either its `Technician` or its
  `Service`; because a booking stores its own `serviceId` / `technicianId`,
  dropping a qualification never affects a booking.

## Constraints and indexes

Prisma-level:

- Unique: `User.email`, `ServiceCategory.slug`, `Service.slug`,
  `Technician.userId`, `Booking.slotId`,
  `AvailabilitySlot(technicianId, serviceId, startsAt)` (exact-duplicate guard),
  `TechnicianService(technicianId, serviceId)` (Milestone 11 — one qualification
  row per technician/service).
- Indexes: `User(role)`, `Address(userId)`, `ServiceCategory(active)`,
  `Service(categoryId)`, `Service(active)`, `Technician(active)`,
  `TechnicianService(serviceId)`,
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

### Pricing (Milestone 8)

- **No schema change, no migration.** No pricing table, no price-history table,
  no rules table, no JSON rules engine. The existing `Service.basePriceCents` /
  `Service.currency` (current price) plus the `Booking` snapshot columns are
  sufficient for the MVP.
- The pricing service reads one row via `catalogRepository.findActivePriceBySlug`
  — `SELECT basePriceCents, currency FROM Service WHERE slug = ? AND active`,
  served by the unique `Service.slug` index. Single indexed read, no join, no
  N+1.
- Pricing performs **no writes**. The quote is derived by the pure
  `calculateServicePrice` function in `@aisbp/shared`; `Booking` persistence of
  the immutable snapshot is Milestone 9's responsibility (see
  [API Boundaries](api.md#price-snapshot-boundary)).

### Booking workflow (Milestone 9)

- **No schema change, no migration.** `Booking` and `BookingStatusHistory`, and
  every constraint added in the initial migration (`booking_time_valid`,
  `booking_price_non_negative`, `booking_price_total_consistent`, the
  `Booking.slotId` UNIQUE, and the `onDelete: Restrict` foreign keys) are used
  unchanged.
- **Double-booking guard**: the `Booking.slotId` UNIQUE index. Creation runs in
  `prisma.$transaction`; a concurrent create for the same slot loses the
  `INSERT` race, PostgreSQL aborts its transaction, and the API returns `409`.
  No `SELECT ... FOR UPDATE`, no application-level lock, no "check then insert".
- **Price snapshot** is written from the pricing calculation applied to the
  `Service` row read **inside the booking transaction**, so a concurrent
  reprice cannot desync it. Once written it is never recomputed — verified by an
  integration test (book at 10000, reprice to 25000, the booking still reads
  10000).
- **Index review**: the customer list is `where { customerId } order by
createdAt desc` → `Booking(customerId, createdAt)`. The technician list is
  `where { technicianId } order by scheduledStart` → `Booking(technicianId,
scheduledStart)`. Status history is `where { bookingId } order by createdAt` →
  `BookingStatusHistory(bookingId, createdAt)`. All covered; **no new index**.
- **Slot on cancel**: a cancelled booking keeps its `slotId` link and the slot
  stays `booked`. Because `Booking.slotId` is UNIQUE, a cancelled slot cannot be
  re-booked; reclaiming it is an operations concern for a later milestone.

### Operations dashboard (Milestone 10)

- **No schema change, no migration, no new index.** The operations booking queue
  filters on `Booking.status` (existing `Booking(status)` index), on a
  `scheduledStart` range (existing `Booking(scheduledStart)` index), and does a
  case-insensitive `contains` on customer name / email / service name via joins
  (`ILIKE`, which no btree serves — acceptable at MVP scale, same reasoning as
  the catalogue `q` search). Sorting is by `createdAt` or `scheduledStart` with
  an `id` tiebreaker.
- Dashboard metrics use `prisma.booking.count` / `groupBy` aggregation and
  `prisma.technician.count`; the bookings table is never loaded into memory.
- `BookingStatusHistory.changedByUserId` records the acting operator for every
  operations status change; the relation to `User` is `onDelete: SetNull`.

### Technician management & assignment (Milestone 11)

- **Schema change: one new table.** `TechnicianService` (`id`, `technicianId`,
  `serviceId`, `createdAt`) — the technician ↔ service qualification join that
  Milestone 7 deferred. It is required because assignment (M11) must reject a
  technician who is not qualified for a booking's service, and that relationship
  cannot be derived safely from availability slots.
- **Migration**: `packages/database/prisma/migrations/20260901120000_technician_service`
  — `CREATE TABLE` + two `Restrict`-free `ON DELETE CASCADE` foreign keys +
  `UNIQUE (technicianId, serviceId)` + `INDEX (serviceId)`. Verified from an
  empty database (`prisma migrate deploy` runs both migrations in order in CI).
  No existing table, constraint, referential action, or index was changed or
  weakened.
- **Index justification**: the unique index backs the duplicate-qualification
  guard and the `technicianId_serviceId` point lookup in assignment; the
  `serviceId` index backs "which active technicians are qualified for service X"
  in the assignable-technicians query. No speculative indexes.
- **Seed**: six deterministic `TechnicianService` rows (Tomas: washing machine /
  dishwasher / refrigerator; Tara: Wi-Fi mesh / smart doorbell / thermostat),
  upserted by the unique key. No seeded bookings (kept, so the slot rebuild stays
  idempotent).
- **Assignment concurrency**: `assignTechnician` and the technician-mutating
  methods (`setActive`, `addQualification`, `removeQualification`) take a
  `SELECT ... FOR UPDATE` row lock on the target `Technician` inside their
  transaction, so assignments / deactivations / qualification changes for one
  technician serialise. Booking-row conditional `updateMany` guards the booking
  itself. `Booking.slotId` UNIQUE and the availability exclusion constraint are
  untouched.
- **Technician job status**: `changeJobStatusForTechnician` is owner-scoped
  (`where: { id, technicianId }`), transactional, conditional, and records
  `BookingStatusHistory` with the technician's user id.

### Search, filtering & pagination performance (Milestone 12)

- **No schema change, no migration, no new index.** M12 made every list endpoint
  consistent (`page` / `limit` / `sort` / status filter, shared `paginationMeta`)
  and added DB-side pagination + a `count` to the customer and technician booking
  lists, which previously returned unbounded results.
- **Query plans** were measured against ~3,000 seeded bookings (≈430 per status)
  with `EXPLAIN (ANALYZE, BUFFERS)` on PostgreSQL 14:

  | Query shape                                                                 | Plan                                                                                         | Execution                           |
  | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------- |
  | operations queue — `status = ?` + `createdAt` sort + `LIMIT 20`             | Bitmap Index Scan `Booking_status_idx` → sort → limit                                        | **0.23 ms** (0.66 ms at offset 400) |
  | operations queue — no filter, `createdAt` sort                              | Seq Scan → top-N heapsort → limit                                                            | 0.86 ms                             |
  | customer list — `customerId = ?` + `status = ?` + `createdAt` sort          | Index Scan Backward `Booking_customerId_createdAt_idx` + filter                              | **0.04 ms**                         |
  | technician list — `technicianId = ?` + `status = ?` + `scheduledStart` sort | Index Scan `Booking_scheduledStart_idx` / `Booking_technicianId_scheduledStart_idx` + filter | **0.04 ms**                         |
  | `count(*) WHERE status = ?`                                                 | Bitmap Index Scan `Booking_status_idx`                                                       | 0.29 ms                             |

- **Index decision — no index added.** The existing `Booking(status)`,
  `Booking(customerId, createdAt)`, `Booking(technicianId, scheduledStart)`,
  `Booking(scheduledStart)` indexes serve every list query sub-millisecond at
  3k rows. The one seq scan (unfiltered operations queue) is a bounded top-N
  heapsort, not a full sort. A `Booking(status, createdAt)` composite would turn
  the operations-queue filter+sort into a pure index range scan (no sort at any
  offset); measured cost does **not** justify it yet. **Deferred** with a clear
  trigger: revisit once the bookings table passes ~tens of thousands of rows or
  the operations-queue p95 latency is measured above a few milliseconds.
- Text `q` search stays `ILIKE` (catalogue and operations); a `pg_trgm` GIN
  index remains the documented scale-up, out of scope for the MVP.

### Redis caching (Milestone 13)

- **No schema change, no migration, no index, no new model.** Redis caching is
  an application-layer optimisation only; nothing about the relational schema
  changed and no cache data is part of the relational source of truth.
- **PostgreSQL stays authoritative.** The read-through cache
  (`apps/api/src/lib/cache.ts`) serves only the three public catalogue endpoints
  and holds plain DTO copies with a 120 s TTL. Booking state, price snapshots,
  technician assignment, availability, ownership, and status transitions are
  always read from PostgreSQL. A Redis outage degrades a cached read to a direct
  query.
- **Invalidation is TTL-only** for the catalogue because categories, services,
  and `basePriceCents` have no runtime write path (migration/seed only). A
  future service-admin milestone that adds such a write must call
  `catalogueService.invalidate()` and consider precise pricing invalidation
  before caching `GET /api/v1/services/:slug/price`.

### Performance review (Milestone 16)

**No schema migration, no index added, no constraint changed.** Query plans
were measured against a synthetic dataset (30 000 bookings, 20 000 users,
37 000 slots) — full table in
[Performance](performance.md#measured--milestone-16). Every list query is
served by an existing index or is a bounded top-N / aggregate scan. Two hot
paths are documented deferrals with measured triggers:

- **`Booking(status, createdAt)` composite** (the M12 deferral) — would turn the
  unfiltered operations queue (Seq Scan → top-N, 31 ms at 30k rows) and the
  status-filtered queue into pure index scans. Trigger: bookings table beyond
  a few hundred thousand rows.
- **`pg_trgm` GIN on `User.name` / `User.email` / `Service.name`** (the M12
  deferral) — the operations `q` search is a full `User` scan (122 ms at 20k
  users). Operations-only; trigger: user table beyond ~50 000 rows.

Two validation floors were added at the Zod boundary (not as DB CHECKs, to
match how `SLOT_MAX_HOURS` is already enforced): `SLOT_MIN_MINUTES = 15` (stops
a technician flooding the calendar with tiny slots) and
`AVAILABILITY_PUBLIC_MAX_SLOTS = 250` (a `take` on the public availability read).
`PAGE_MAX` was lowered from 10 000 to 1 000 so `page` can no longer force a
~200 ms deep-offset sort.

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

### Prisma engine targets (Milestone 17)

The `generator client` block gained
`binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` so the generated client
carries the musl OpenSSL 3 query engine used inside the Alpine production image
as well as the local/CI (glibc) `native` engine. This is a **client-generation
config only** — `prisma migrate diff` reports no difference, there is no new
migration, and the data model is unchanged.

### Container migration flow (Milestone 17)

In `docker-compose.prod.yml` a one-shot `migrator` container (the `migrator`
target of `apps/api/Dockerfile`) runs **`prisma migrate deploy`** — committed
migrations only — against the Postgres service once it is healthy, then exits.
The `api` container has `depends_on: { migrator: service_completed_successfully }`,
so it never starts against an un-migrated schema. The production path **never**
runs `prisma migrate reset`, `prisma migrate dev`, or `prisma db push`
(`db:reset` is a developer-only convenience). Seeding is **not** part of the
container startup — a fresh production database has schema but no rows until
someone runs `db:seed` deliberately. The CI `docker` job verifies the migrator
applied the committed migrations to a clean database and that a second run is a
no-op.

### Deployment migration & roll-forward (Milestone 18)

`docker-compose.deploy.yml` uses the **published** `migrator` image
(`ghcr.io/sumit-0610/ai-service-booking-platform-migrator:<tag>`) with the same
one-shot `prisma migrate deploy` semantics — no schema change and no new
migration were introduced for M18. Deployment order is: pull images → Postgres/
Redis healthy → `migrate deploy` → API/web start → verify health. A migration
that cannot be applied fails the migrator loudly and the API's `depends_on`
keeps it from starting against a broken schema.

Because Prisma migrations are **forward-only**, a bad release is recovered by:
(1) redeploying the previous known-good image tag _if_ it is schema-compatible
(**application** rollback), then (2) authoring a **new corrective migration**
that fixes the schema going forward — never a destructive reverse of an applied
migration. See [Deployment](deployment.md#17-database-roll-forward-strategy).

## Seed

```bash
pnpm --filter @aisbp/database db:seed
```

Deterministic and safe to re-run. It creates: five users (two customers, one
operations, two technicians), three customer addresses (Indian demo data),
three service categories,
fourteen services (thirteen active plus one inactive, to exercise catalogue
filtering), two technicians with three service qualifications each, and one week
of upcoming, non-overlapping availability slots. Every seeded account has the
development password
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
