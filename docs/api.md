# API Boundaries

The backend exposes a versioned REST API under `/api/v1`.

## API Principles

- Validate request bodies, params, and query strings with Zod at the API boundary.
- Keep controllers thin and delegate business behavior to services.
- Use consistent pagination for list endpoints.
- Use consistent error response shapes.
- Enforce authentication and role authorization before service calls.
- Never let AI endpoints directly mutate booking, user, address, technician, or availability records.

## Common Patterns

List endpoints paginate with `page` (1-based) and `limit`, and sort with a
single `sort` parameter whose values encode both field and direction (e.g.
`price_asc`). List responses wrap results as
`{ items: [...], pagination: { page, limit, total, totalPages, hasNextPage, hasPreviousPage } }`.
Every sort has a stable tiebreaker so pages never overlap or skip rows.

Filtering uses an explicit, per-endpoint allow-list of query parameters. Unknown
parameters are ignored; no client-supplied filter is ever passed to the
database.

### List conventions (Milestone 12)

Every collection endpoint shares one contract, backed by
`@aisbp/shared`'s `pageParams` / `paginationMeta`:

| Aspect       | Rule                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `page`       | integer ≥ 1, ≤ 10000; out of range → `422` (never clamped)                                                                                                                           |
| `limit`      | integer ≥ 1, per-endpoint cap (catalogue 48, operations 100, customer & technician lists 50); out of range → `422`                                                                   |
| `sort`       | a closed `enum`; an unknown value → `422`. Every ordering ends with an `id` tiebreaker, so pages never overlap or skip rows and repeating a request returns the same order           |
| filters      | a fixed allow-list per endpoint; an unknown status/filter value → `422`; unknown query keys are ignored; **no** client `where` / `select` / `orderBy` / field name reaches Prisma    |
| `pagination` | `{ page, limit, total, totalPages, hasNextPage, hasPreviousPage }` from a single `count` alongside the page query (one snapshot); a page past the end is an empty page, not an error |
| performance  | the page and its `count` run against the same DB indexes; no application-side filtering of result sets; no N+1                                                                       |

Paginated endpoints: `GET /api/v1/services`, `GET /api/v1/bookings`,
`GET /api/v1/technician/bookings`, `GET /api/v1/operations/bookings`,
`GET /api/v1/operations/technicians`. `GET /api/v1/categories` and the
availability endpoints are intentionally window-/scope-bounded instead (a
handful of categories; a bounded date window for slots) — see
[Availability](#availability--scheduling-implemented--milestone-7).

Standard error shape (implemented):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "email", "message": "Invalid email address" }]
  }
}
```

Error codes in use: `VALIDATION_ERROR` (422), `INVALID_CREDENTIALS` (401),
`UNAUTHENTICATED` (401), `FORBIDDEN` (403), `CSRF_ERROR` (403), `EMAIL_TAKEN`
(409), `RATE_LIMITED` (429), `NOT_FOUND` (404), `CONFLICT` (409),
`INTERNAL` (500).

## Public Catalogue Endpoints (implemented — Milestone 5)

No authentication. Only **active** categories and services are ever returned,
and responses carry public fields only (no `active` flag, no timestamps, no raw
foreign keys).

```txt
GET /api/v1/categories            -> 200 { items: Category[] }
GET /api/v1/services              -> 200 { items: Service[], pagination }
GET /api/v1/services/:slug        -> 200 { service: Service }  | 404
```

`Category` = `{ id, slug, name, description }`.
`Service` = `{ id, slug, name, description, priceCents, currency, durationMinutes, category: { id, slug, name } }`.

### `GET /api/v1/services` query parameters

| Param      | Type                                                                 | Default    | Notes                                                                                                  |
| ---------- | -------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `q`        | string, 1–100 chars                                                  | —          | Case-insensitive substring match on service name **or** description. Empty/blank is treated as absent. |
| `category` | string (category slug)                                               | —          | Filter to one active category. An unknown slug returns an empty page, not an error.                    |
| `sort`     | `name_asc` \| `name_desc` \| `price_asc` \| `price_desc` \| `newest` | `name_asc` | Every ordering has a stable `id` tiebreaker, so pagination is deterministic.                           |
| `page`     | integer ≥ 1 (≤ 10000)                                                | `1`        |                                                                                                        |
| `limit`    | integer 1–48                                                         | `12`       | Values outside the range are rejected with `422`, never clamped.                                       |

Unknown query parameters are ignored. The server builds the Prisma `where`
clause from this allow-list only — no client-supplied filter is passed through.

`pagination` = `{ page, limit, total, totalPages, hasNextPage, hasPreviousPage }`.

Errors: invalid query params or a malformed `:slug` → `422 VALIDATION_ERROR`;
an unknown or inactive service slug → `404 NOT_FOUND`.

These three responses are served through a Redis read-through cache
(Milestone 13) — see [Caching](#caching-milestone-13). The cache is transparent:
the DTO, status codes, validation, pagination, sorting, and 404 behaviour are
identical whether a response came from PostgreSQL or Redis.

### Later milestones

`GET /api/v1/availability` and booking endpoints arrive in their own milestones.

## Caching (Milestone 13)

A read-through cache (`apps/api/src/lib/cache.ts`) sits between the catalogue
service and its repository, over the same single Redis connection used for
sessions and rate limiting. It is a **pure optimisation** in front of the
PostgreSQL source of truth.

### What is cached

| Endpoint                        | Key                                                                        | TTL   |
| ------------------------------- | -------------------------------------------------------------------------- | ----- |
| `GET /api/v1/categories`        | `cache:catalogue:v1:categories`                                            | 120 s |
| `GET /api/v1/services` (no `q`) | `cache:catalogue:v1:services:cat=<slug\|_>:sort=<sort>:page=<n>:limit=<n>` | 120 s |
| `GET /api/v1/services/:slug`    | `cache:catalogue:v1:service:<slug>` (200 responses only)                   | 120 s |

Keys are built **after** Zod validation, from the query allow-list only. Keys
are namespaced (`cache:`), owner-labelled (`catalogue`), and versioned (`v1`) so
a contract change is a clean miss, not a decode error. The stored form is an
explicit JSON envelope (`{ v, data }`) holding the exact DTO; on read it is
re-parsed against the DTO's Zod schema, so a drifted entry is treated as a miss.
`CATALOGUE_CACHE_TTL_SECONDS` (default 120) and `CACHE_ENABLED` (default true)
are the only configuration; TTLs are never hard-coded.

### What is deliberately not cached

- **Free-text search** (`?q=`) — unbounded key space, not a hot path; always live.
- **Pricing** (`GET /api/v1/services/:slug/price`) — Milestone 8 made the quote a
  _live_ projection of `Service.basePriceCents`, and there is no service-price
  write endpoint to hook precise invalidation onto. A TTL cache would serve
  prices that contradict the "quote reflects the price at request time"
  contract. Revisit when a price-management endpoint lands.
- **Availability** (`GET /api/v1/services/:slug/availability`) — time-sensitive,
  `now`-relative windows, and mutated by two independent write paths (technician
  slot CRUD and booking creation). Milestone 9 booking creation already
  re-validates the slot inside its transaction; a cache would add staleness risk
  for negligible gain.
- **Every authenticated / per-user response** — customer bookings, technician
  jobs, operations dashboard/bookings/technicians. Private, per-scope, and
  frequently mutated.

### Invalidation

Catalogue rows (categories, services, prices) change only through a migration or
the seed — there is no runtime write path — so invalidation is **TTL-only**. The
service exposes `catalogueService.invalidate()` (a precise
`SCAN` + `DEL` over `cache:catalogue:v1:*`, never `FLUSHDB`) for a future
service-admin milestone to call after a write.

### Redis failure behaviour

Every cache operation is wrapped: a Redis outage, a connection error, a corrupt
value, or a shape mismatch is logged at `warn` and returns a **cache miss**, so
the request is served from PostgreSQL. A Redis outage never turns a healthy read
API into an error. `CACHE_ENABLED=false` bypasses the cache entirely.

### Concurrency

Standard read-through: hit → return; miss → PostgreSQL → populate → return.
There is no single-flight lock. Concurrent misses on a cold key each run the
underlying query once; those queries are the sub-millisecond indexed reads
measured in Milestone 12, so the small stampede window is acceptable for the
MVP.

## Authentication Endpoints (implemented — Milestone 4)

```txt
POST /api/v1/auth/register   -> 201 { user }          (rate limited per IP)
POST /api/v1/auth/login      -> 200 { user }          (rate limited per IP + email)
POST /api/v1/auth/logout     -> 204                    (session + X-CSRF-Token required)
GET  /api/v1/auth/me         -> 200 { user }           (session required)
```

- `user` is `{ id, email, name, role }` — never the password hash.
- Register and login set an `HttpOnly` session cookie (`aisbp.sid`) and a
  readable CSRF cookie (`aisbp.csrf`). Clients must send `credentials: 'include'`
  and echo the CSRF cookie in `X-CSRF-Token` on state-changing requests.
- `register` creates a `customer`. Duplicate email → `409 EMAIL_TAKEN`.
- `login` returns a single generic `401 INVALID_CREDENTIALS` for both unknown
  email and wrong password.
- See [Authentication Strategy](authentication.md) for session, CSRF, and
  authorization details.

## Customer Address Endpoints (implemented — Milestone 6)

Authenticated, **customer role only**. Operations and technicians get `403`.
Every request is scoped to the caller's own user id.

```txt
GET    /api/v1/addresses          -> 200 { items: Address[] }
POST   /api/v1/addresses          -> 201 { address }        (X-CSRF-Token)
GET    /api/v1/addresses/:id      -> 200 { address } | 404
PATCH  /api/v1/addresses/:id      -> 200 { address } | 404   (X-CSRF-Token)
DELETE /api/v1/addresses/:id      -> 204 | 404 | 409         (X-CSRF-Token)
```

`Address` = `{ id, label, line1, line2: string | null, city, state, postalCode, country }`.
`userId` and timestamps are never returned.

**Body fields** (create requires all except `line2`; PATCH is a partial update and
rejects an empty body):

| Field        | Rule                                                                             |
| ------------ | -------------------------------------------------------------------------------- |
| `label`      | trimmed, 1–60 chars                                                              |
| `line1`      | trimmed, 1–120 chars                                                             |
| `line2`      | trimmed, ≤ 120 chars; empty/blank stored as `null`                               |
| `city`       | trimmed, 1–80 chars                                                              |
| `state`      | trimmed, 1–80 chars (state / province / region — required by the model)          |
| `postalCode` | trimmed, 1–16 chars, `[A-Za-z0-9 -]` only — **no country-specific format check** |
| `country`    | ISO 3166-1 alpha-2, uppercased (e.g. `IN`)                                       |

Only these fields are persisted. Any other key in the body → `422` (`.strict()`),
so `userId`, `id`, `isDefault`, etc. cannot be mass-assigned.

**Errors**: unauthenticated → `401`; wrong role → `403 FORBIDDEN`; missing/blank
CSRF token on a mutation → `403 CSRF_ERROR`; invalid body → `422`; malformed
`:id` (not `[A-Za-z0-9-]{8,64}`) → `422`; **an address that does not exist _or_
belongs to another customer** → `404 NOT_FOUND` (identical, so ownership is not
revealed); deleting an address still referenced by a booking →
`409 CONFLICT` (the `Booking.address` FK is `onDelete: Restrict`, so historical
bookings keep their address).

Normalization is limited to trimming, `line2` empty → `null`, and `country`
uppercasing. Casing of every other field is preserved as entered.

## Availability & Scheduling (implemented — Milestone 7)

### Timestamp format

Every instant on the wire is an ISO 8601 string. **On input it must carry a
timezone designator** — `Z` (UTC) or `±HH:MM`; a bare wall-clock string is
rejected with `422`. **Responses are always UTC** with millisecond precision,
e.g. `2026-09-15T09:00:00.000Z`. All business logic runs in UTC; the web client
renders instants in the viewer's local timezone.

### Public availability (customer)

No authentication. Only an **active** service exposes availability.

```txt
GET /api/v1/services/:slug/availability?from=<iso>&to=<iso>
  -> 200 { items: Slot[], window: { from, to } }  | 404 (unknown/inactive service)
```

- `from` defaults to now; `to` defaults to `from + 14 days`. The window may not
  exceed **62 days** and `to` must be after `from` (`422` otherwise).
- Returns only slots that are in the **future** (`startsAt > now`, regardless of
  `from`), `available`, unbooked, and belong to an **active** technician.
- `Slot` = `{ id, startsAt, endsAt, durationMinutes }` — no technician, no
  service id, no status, no internal fields.
- Ordered by `startsAt` then `id` (deterministic).

### Technician availability (technician)

`requireAuth` → `requireRole('technician')` → the technician profile is resolved
from the session; mutations require `X-CSRF-Token`. **Customers and operations
get `403`.**

```txt
GET    /api/v1/technician/availability          -> 200 { items: TechSlot[] }
POST   /api/v1/technician/availability          -> 201 { slot }        (X-CSRF-Token)
PATCH  /api/v1/technician/availability/:id      -> 200 { slot } | 404  (X-CSRF-Token)
DELETE /api/v1/technician/availability/:id      -> 204 | 404 | 409     (X-CSRF-Token)
```

- `GET` returns the technician's own upcoming slots (`endsAt >= now`), ordered by
  `startsAt`. `TechSlot` = `{ id, service: { slug, name }, startsAt, endsAt, durationMinutes, status, booked }`.
- `POST` / `PATCH` body: `{ serviceSlug, startsAt, endsAt }` (`PATCH` is partial,
  non-empty). `.strict()` — **`technicianId`, `userId`, `status`, `bookingId` and
  any other key are rejected with `422`.** The authenticated technician always
  owns the slot.
- Rules: `endsAt > startsAt`; duration ≤ 12 h; `startsAt` in the future and
  within 365 days; the service must exist and be **active** (else `422` on
  `serviceSlug`). A booked slot cannot be edited or deleted (`409`).
- **Ownership**: every query, update and delete carries `where: { id, technicianId }`.
  Another technician's slot returns `404` — the same as a missing one.
- Malformed `:id` (not `[A-Za-z0-9-]{8,64}`) → `422`.

### Overlap behaviour

A PostgreSQL exclusion constraint (`availability_slot_no_overlap`, GiST over
`technicianId` + `tstzrange(startsAt, endsAt, '[)')`) is the authoritative
guard. The API never does a read-then-insert overlap check — it attempts the
write and maps the database's rejection to `409 CONFLICT`, which is correct under
concurrent requests.

- Adjacent slots (`10:00–11:00`, `11:00–12:00`) are **allowed**.
- Overlapping slots (`10:00–11:00`, `10:30–11:30`) are **rejected** (`409`).
- Two concurrent overlapping creates: exactly one succeeds, the other gets `409`.

## Service Pricing (implemented — Milestone 8)

### Money representation

Every monetary figure is an **integer number of minor units** ("cents"):
`1050` means `$10.50`. There is no floating-point arithmetic in pricing. A
client may name a service (by slug); it may **never** submit a price, subtotal,
fee, tax, discount, or total — the server derives all of them.

### Public price quote

No authentication. An authenticated customer receives the identical quote. Only
an **active** service is quotable.

```txt
GET /api/v1/services/:slug/price   -> 200 { quote: PriceQuote }
```

- Malformed slug (not `^[a-z0-9]+(?:-[a-z0-9]+)*$`) → `422 VALIDATION_ERROR`.
- Well-formed slug matching no active service → `404 NOT_FOUND`.
- The quote reflects `Service.basePriceCents` **at request time** — it is a live
  price, not a snapshot.

```jsonc
// PriceQuote
{
  "currency": "USD",
  "subtotalCents": 10000,
  "feesTotalCents": 0,
  "discountTotalCents": 0,
  "taxTotalCents": 0,
  "totalCents": 10000,
  "breakdown": { "lines": [{ "label": "Service", "amountCents": 10000 }] },
}
```

### Calculation rules (MVP)

```txt
subtotalCents = Service.basePriceCents
feesTotalCents = 0
discountTotalCents = 0
taxTotalCents = 0
totalCents = subtotalCents + feesTotalCents + taxTotalCents - discountTotalCents
currency = Service.currency
```

`totalCents` always satisfies the PostgreSQL `booking_price_total_consistent`
CHECK. The zero components are structural placeholders — the product has defined
no fee, tax, discount, coupon, or multi-currency rules, and none are computed.
No percentages, so **no rounding** is performed. If percentage-based components
are added later, their rounding rules must be defined before implementation.

### Price snapshot boundary

```txt
Service.basePriceCents  ->  pricing service  ->  PriceQuote  ->  (M9) Booking creation  ->  immutable Booking price snapshot
```

The pricing service is a **pure read**. It never writes a `Booking`. The
Milestone 9 booking workflow will call the pricing service and persist the
resulting figures into the booking's immutable snapshot
(`priceCurrency`, `priceSubtotalCents`, `priceFeesTotalCents`,
`priceDiscountTotalCents`, `priceTaxTotalCents`, `priceTotalCents`,
`priceBreakdown`) inside the same transaction that creates the booking. Once
written, the snapshot never changes, even if `Service.basePriceCents` later does.

## Booking Workflow (implemented — Milestone 9)

### Customer endpoints

Authenticated, **customer role only** (operations / technicians get `403`).
Every query is scoped to the caller's own id in the repository. Mutations
require a CSRF token.

```txt
GET  /api/v1/bookings                       -> 200 { items: Booking[], pagination }
POST /api/v1/bookings                       -> 201 { booking }         (X-CSRF-Token)
GET  /api/v1/bookings/:id                   -> 200 { booking } | 404
GET  /api/v1/bookings/:id/status-history    -> 200 { items: StatusEvent[] } | 404
POST /api/v1/bookings/:id/cancel            -> 200 { booking } | 404 | 409  (X-CSRF-Token)
```

`GET /api/v1/bookings` query params (Milestone 12): `status` (one of the 7
booking statuses), `sort` (`created_desc` \| `created_asc` \| `scheduled_asc` \|
`scheduled_desc`, default `created_desc`), `page` (≥ 1, ≤ 10000), `limit` (1–50,
default 10). See [List conventions](#list-conventions-milestone-12).

`Booking` (customer DTO — no user ids, no raw model):

```jsonc
{
  "id": "clbk…",
  "status": "pending",
  "service": { "slug": "wifi-mesh-setup", "name": "Wi-Fi Mesh Setup" },
  "address": {
    "label": "Home",
    "line1": "…",
    "line2": null,
    "city": "…",
    "state": "…",
    "postalCode": "…",
    "country": "IN",
  },
  "scheduledStart": "2026-09-15T09:00:00.000Z",
  "scheduledEnd": "2026-09-15T11:00:00.000Z",
  "customerNotes": null,
  "price": {
    "currency": "USD",
    "subtotalCents": 12000,
    "feesTotalCents": 0,
    "discountTotalCents": 0,
    "taxTotalCents": 0,
    "totalCents": 12000,
    "breakdown": { "lines": [{ "label": "Service", "amountCents": 12000 }] },
  },
  "createdAt": "2026-09-01T12:00:00.000Z",
}
```

`StatusEvent` = `{ from: BookingStatus | null, to: BookingStatus, reason: string | null, at: <iso> }`.

**Create body** — only `{ slotId, addressId, customerNotes? }`, `.strict()`. The
service, technician, scheduled time and every price field are derived
server-side from the slot and the pricing calculation; sending `status`,
`technicianId`, `customerId`, `serviceId`, `scheduledStart`, or any `price*`
field is `422`.

Creation runs in **one PostgreSQL transaction** that:

1. confirms the address belongs to the caller (else `422` on `addressId`);
2. loads the slot and confirms its service is active (`422`), its technician is
   active, its status is `available` and it has no booking (`409`), and it
   starts in the future (`422`);
3. snapshots the price with the pricing calculation from the service row read
   **in the same transaction**;
4. inserts the `Booking` (status `pending`, `technicianId` copied from the slot),
   its initial `BookingStatusHistory` row, and flips the slot to `booked`.

The authoritative double-booking guard is the `Booking.slotId` UNIQUE
constraint: two concurrent creates for the same slot both pass step 2, but only
one `INSERT` wins — the other's transaction is aborted by PostgreSQL and the API
returns `409`. There is **no** race-prone application-level "check then insert".

### Status lifecycle

The documented state machine (see [domain model](domain-model.md#booking-state-machine))
is the single source of truth. In Milestone 9 a booking is created as `pending`
and the only wired transition is **customer cancellation**
(`pending | confirmed | assigned -> cancelled`), which appends a
`BookingStatusHistory` row atomically. Cancelling from any other state is `409`.
Operations confirmation/assignment (M10) and the technician job-status flow
(M11) will drive the remaining transitions; the transition table already
encodes them.

### Technician job endpoints

```txt
GET   /api/v1/technician/profile             -> 200 { profile }
GET   /api/v1/technician/bookings            -> 200 { items: TechnicianBooking[], pagination }
GET   /api/v1/technician/bookings/:id        -> 200 { booking: TechnicianJob } | 404
PATCH /api/v1/technician/bookings/:id/status -> 200 { booking } | 404 | 409   (X-CSRF-Token)
```

`GET /api/v1/technician/bookings` takes the same `status` / `sort` / `page` /
`limit` params as `GET /api/v1/bookings` (Milestone 12).

`requireAuth -> requireRole('technician') -> loadTechnician`. Ownership is
`authenticated user -> Technician.userId -> Technician.id -> Booking.technicianId`,
enforced in the repository `where: { id, technicianId }` — another technician's
job is a `404` (non-enumerating), never a `403`. A booking is linked to a
technician either because the customer booked that technician's slot (M9) or
because operations assigned them (M11).

- `profile` = `{ displayName, serviceArea, active, qualifications: [{ slug, name }] }` —
  read-only; a technician never manages their own record.
- `TechnicianBooking` / `TechnicianJob` carry service, customer name, address,
  schedule and notes, but **not** the price snapshot. `TechnicianJob` (detail)
  adds the `statusHistory` timeline.
- `PATCH .../status` body — `{ status, reason? }`, `.strict()`; `status` must be
  `in_progress` or `completed`. The transition is checked against the `technician`
  actor in the shared state machine (`assigned -> in_progress -> completed`);
  anything else → `409` or `422`. Transactional conditional update; history
  recorded with the technician's user id. An **inactive** technician may still
  progress a job already assigned to them.

## Operations Dashboard (implemented — Milestone 10)

`requireAuth -> requireRole('operations')`. Unauthenticated -> `401`; any other
role -> `403`. Operations reads span **every** booking (not owner-scoped);
access is gated purely by the role. Mounted at `/api/v1/operations`.

```txt
GET   /api/v1/operations/dashboard              -> 200 { dashboard }
GET   /api/v1/operations/bookings               -> 200 { items: OperationsBookingSummary[], pagination }
GET   /api/v1/operations/bookings/:id           -> 200 { booking: OperationsBooking } | 404
PATCH /api/v1/operations/bookings/:id/status    -> 200 { booking } | 404 | 409   (X-CSRF-Token)
```

### `GET /operations/bookings` query parameters

| Param         | Type                                                                   | Default        | Notes                                                               |
| ------------- | ---------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------- |
| `status`      | one of the 7 booking statuses                                          | —              | exact match; unknown value → `422`                                  |
| `q`           | string, 1–100 chars                                                    | —              | case-insensitive substring of customer name / email or service name |
| `from` / `to` | ISO-8601 with offset                                                   | —              | `scheduledStart` half-open range `[from, to)`; malformed → `422`    |
| `sort`        | `created_desc` \| `created_asc` \| `scheduled_asc` \| `scheduled_desc` | `created_desc` | every ordering has a stable `id` tiebreaker                         |
| `page`        | integer ≥ 1 (≤ 10000)                                                  | `1`            |                                                                     |
| `limit`       | integer 1–100                                                          | `20`           | out-of-range → `422`, never clamped                                 |

Unknown parameters are ignored; the server builds the Prisma `where` from this
allow-list only. `OperationsBookingSummary` =
`{ id, status, service: {slug,name}, customerName, technicianName: string|null,
scheduledStart, scheduledEnd, totalCents, currency, createdAt }` — no customer
email, no address, no raw model.

### `GET /operations/bookings/:id`

Malformed `:id` (not `[A-Za-z0-9-]{8,64}`) → `422`; unknown → `404`.
`OperationsBooking` adds `customerEmail`, the full `address`, `customerNotes`,
the complete `price` snapshot, and `statusHistory` (each event carries the
actor's name and role: `{ from, to, reason, by, byRole, at }`).

### `PATCH /operations/bookings/:id/status`

Body — `{ status, reason? }`, `.strict()`. `status` must be one of
`confirmed` | `rejected` | `cancelled` (an operator cannot set `assigned`,
`in_progress`, `completed`, or `pending` directly). Any other key
(`technicianId`, `priceTotalCents`, `changedByUserId`, …) → `422`.

The transition is checked against the shared state machine for the `operations`
actor — in Milestone 10 the reachable transitions are `pending -> confirmed`,
`pending -> rejected`, and `confirmed -> cancelled`. A disallowed transition
(including `pending -> cancelled`, which is a customer-only transition) → `409`.
The change runs in a transaction with a conditional update, so a concurrent
status change is rejected with `409` rather than lost, and a
`BookingStatusHistory` row is written with the acting operator as
`changedByUserId`.

### Dashboard metrics

`GET /operations/dashboard` returns `{ dashboard }` where `dashboard` is:

```jsonc
{
  "bookings": {
    "total": 42,
    "byStatus": {
      "pending": 5,
      "confirmed": 8,
      "assigned": 0,
      "in_progress": 0,
      "completed": 27,
      "cancelled": 1,
      "rejected": 1,
    },
    "active": 13, // status in pending | confirmed | assigned | in_progress
    "upcoming": 9, // active set AND scheduledStart >= now
  },
  "revenue": {
    "byCurrency": [{ "currency": "USD", "committedTotalCents": 372000 }],
    // sum of priceTotalCents for bookings whose status is not cancelled/rejected,
    // grouped by the booking's own snapshot currency
  },
  "technicians": { "total": 2, "active": 2 },
}
```

Every figure is a database aggregation (`count` / `groupBy`), never computed by
loading rows into memory, and never fabricated.

## Technician Management & Assignment (implemented — Milestone 11)

`requireAuth -> requireRole('operations')`, CSRF on mutations. Mounted at
`/api/v1/operations` (alongside the dashboard router).

```txt
GET    /api/v1/operations/technicians                         -> 200 { items: TechnicianSummary[], pagination }
GET    /api/v1/operations/technicians/:id                     -> 200 { technician } | 404
PATCH  /api/v1/operations/technicians/:id/status              -> 200 { technician } | 404   (X-CSRF-Token)
POST   /api/v1/operations/technicians/:id/services            -> 201 { technician } | 404 | 409 | 422   (X-CSRF-Token)
DELETE /api/v1/operations/technicians/:id/services/:serviceId -> 200 { technician } | 404   (X-CSRF-Token)

GET    /api/v1/operations/bookings/:id/assignable-technicians -> 200 { items: AssignableTechnician[] } | 404
POST   /api/v1/operations/bookings/:id/assign-technician      -> 200 { booking } | 404 | 409 | 422   (X-CSRF-Token)
```

- **Technician list** — query `active` (bool), `q` (name / email substring),
  `sort` (`name_asc` \| `name_desc`, default `name_asc` — Milestone 12),
  `page` (≤ 10000), `limit` (1–100, default 20). `TechnicianSummary` =
  `{ id, displayName, serviceArea, active, name, email, qualifiedServiceCount,
activeAssignmentCount }`. No password hash, no user internals. Detail adds
  `qualifications: [{ serviceId, slug, name, active }]`.
- **Active status** — body `{ active: boolean }` `.strict()`. Deactivating a
  technician does **not** touch existing bookings; it only blocks new
  assignments.
- **Qualifications** — `TechnicianService` join. Body `{ serviceId }` `.strict()`.
  The service must exist and be **active** (`422` otherwise); a duplicate is
  `409` (DB `@@unique(technicianId, serviceId)`). Removing a qualification never
  alters historical bookings.

### Booking assignment

- **Assignable technicians** — active technicians qualified for the booking's
  service, excluding the currently-assigned one, each with a
  `hasScheduleConflict` flag (an overlapping `confirmed` / `assigned` /
  `in_progress` booking). Advisory; the server re-checks on assign.
- **Assign / reassign** — body `{ technicianId, reason? }` `.strict()`. Allowed
  when the booking is `confirmed` (first assignment, status → `assigned`) or
  `assigned` (reassignment, stays `assigned`). One transaction that takes a
  `SELECT ... FOR UPDATE` lock on the target `Technician`, then verifies: booking
  in an assignable state (`409` otherwise), target technician exists (`422`),
  active (`422`), qualified for the booking's service (`422`), not already this
  booking's technician (`409`), and has no overlapping committed booking
  (`409`). The booking **keeps its slot** — assignment changes
  `Booking.technicianId` only. A `BookingStatusHistory` row is written with the
  operator; the **price snapshot is never touched**. A concurrent status change
  to the booking is caught by a conditional update (`409`). Two concurrent
  assign requests always leave the booking assigned to exactly one technician.

### Status lifecycle (updated)

The operations dashboard's `PATCH /operations/bookings/:id/status` remains
`confirmed | rejected | cancelled` only — `confirmed -> assigned` is done by the
dedicated assign endpoint above (it needs a technician). The technician job flow
(`assigned -> in_progress -> completed`) is on the technician routes.

## AI Assistant Endpoints

## AI Assistant Endpoints

```txt
POST /api/v1/ai/booking-assistant/intent
POST /api/v1/ai/booking-assistant/clarify
POST /api/v1/ai/booking-assistant/availability
```

Responsibilities:

- Extract structured booking intent from natural language.
- Ask clarification questions when required fields are missing.
- Answer availability questions using backend-provided service and slot context.
- Prepare booking drafts only through normal validation and service boundaries.

AI endpoints must never call repositories directly to mutate state.
