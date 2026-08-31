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

### Later milestones

`GET /api/v1/availability` and booking endpoints arrive in their own milestones.

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
GET  /api/v1/bookings                       -> 200 { items: Booking[] }
POST /api/v1/bookings                       -> 201 { booking }         (X-CSRF-Token)
GET  /api/v1/bookings/:id                   -> 200 { booking } | 404
GET  /api/v1/bookings/:id/status-history    -> 200 { items: StatusEvent[] } | 404
POST /api/v1/bookings/:id/cancel            -> 200 { booking } | 404 | 409  (X-CSRF-Token)
```

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

### Technician endpoints (read-only in M9)

```txt
GET /api/v1/technician/bookings      -> 200 { items: TechnicianBooking[] }
GET /api/v1/technician/bookings/:id  -> 200 { booking } | 404
```

`requireAuth -> requireRole('technician') -> loadTechnician`. Returns only the
jobs booked into **this technician's own slots** (a booking is linked to a
technician because the customer booked that technician's availability slot —
there is no separate assignment step yet). `TechnicianBooking` carries the
service, customer name, address, schedule and notes, but **not** the price
snapshot. `PATCH .../status` is deferred to M11.

## Operations/Admin Endpoints

```txt
GET   /api/v1/operations/dashboard
GET   /api/v1/operations/bookings
GET   /api/v1/operations/bookings/:bookingId
POST  /api/v1/operations/bookings/:bookingId/assign-technician
PATCH /api/v1/operations/bookings/:bookingId/status
```

```txt
GET   /api/v1/operations/technicians
POST  /api/v1/operations/technicians
PATCH /api/v1/operations/technicians/:technicianId
GET   /api/v1/operations/technicians/:technicianId/availability
```

```txt
GET /api/v1/operations/analytics
```

Responsibilities:

- Search, filter, sort, and paginate bookings.
- Assign technicians to eligible bookings.
- Manage technician profiles and active status.
- View availability and operational metrics.

## Technician Endpoints

```txt
GET   /api/v1/technician/bookings
GET   /api/v1/technician/bookings/:bookingId
PATCH /api/v1/technician/bookings/:bookingId/status
```

Responsibilities:

- Show assigned jobs.
- Show job details.
- Allow valid technician status transitions such as `assigned -> in_progress -> completed`.

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
