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

## Booking Endpoints (later milestones)

```txt
GET    /api/v1/bookings
POST   /api/v1/bookings
GET    /api/v1/bookings/:bookingId
PATCH  /api/v1/bookings/:bookingId
POST   /api/v1/bookings/:bookingId/cancel
GET    /api/v1/bookings/:bookingId/status-history
```

Booking creation requirements:

- Validate customer ownership of address.
- Validate selected service is active.
- Validate selected slot is available.
- Calculate final MVP pricing through the pricing service.
- Store price snapshot on the booking.
- Reserve or mark the slot through the booking service.
- Create initial status history.

Booking modification requirements:

- Enforce allowed status rules.
- Revalidate availability if scheduled time changes.
- Recalculate and resnapshot price only when the modification changes price-affecting fields and the user confirms the new price.

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
