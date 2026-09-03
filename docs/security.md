# Security Strategy

## Principles

- Validate all external input.
- Authorize every protected operation.
- Treat AI output as untrusted input.
- Keep secrets out of source control.
- Use transactions for multi-record business mutations.
- Return safe errors to clients.

## Authentication Security (implemented — Milestone 4)

- Passwords hashed with Argon2id (`@node-rs/argon2`, m = 19 MiB, t = 2, p = 1);
  plaintext is never stored or logged.
- Sessions are server-side in Redis; the session id lives in an `HttpOnly`,
  `SameSite=Lax` cookie (`Secure` in production). No token in JavaScript or
  `localStorage`.
- Session fixation: a fresh session id is minted on every login and register,
  and any incoming session id is destroyed first.
- Logout deletes the Redis session and clears the cookies; session expiry is a
  Redis TTL, refreshed on activity (sliding).
- CSRF: synchronizer token stored in the session and required in the
  `X-CSRF-Token` header for state-changing, cookie-authenticated requests.
- Brute force: fixed-window Redis rate limits on `/auth/login` (per IP and per
  email) and `/auth/register` (per IP) → `429 RATE_LIMITED` with `Retry-After`.
- User enumeration: `/auth/login` returns one generic `401` for unknown email or
  wrong password and always runs an Argon2id verify to equalise timing.
- The password hash is never included in any API response (checked by tests).

## Authorization Security (implemented — Milestone 4)

- `requireAuth`, `requireRole(...roles)`, and `requireResourceOwner(getOwnerId)`
  middleware enforce access server-side; the frontend guards are UX only.
- Customer resource ownership is checked server-side; a mismatch returns `404`,
  not `403`, so resource existence is not revealed (IDOR defence).
- Operations may act on any customer resource; customers and technicians cannot
  reach operations routes.
- Technician assignment checks will be layered on `requireResourceOwner` when
  booking routes arrive.

## Address Management Security (implemented — Milestone 6)

- Address routes require `requireAuth` + `requireRole('customer')`. Operations
  and technicians have no access (`403`). Mutations also require a CSRF token.
- Ownership is enforced in the repository: every query, update and delete
  carries `where: { id, userId }`. There is no code path that touches an address
  without a matching user id.
- **IDOR**: reading, updating or deleting another customer's address returns the
  same `404 NOT_FOUND` as a non-existent address — existence is never revealed.
- **Mass assignment**: request bodies are `.strict()` Zod objects; only the
  seven address fields are accepted and only those are written. `userId`, `id`,
  `isDefault` and any other key are rejected with `422`.
- **Malformed identifiers**: `:id` is validated against `[A-Za-z0-9-]{8,64}`;
  anything else is `422` before any query runs. Path-traversal segments never
  reach the handler (Express normalises the path first).
- **Sensitive data**: the DTO omits `userId` and timestamps.
- **Referential integrity**: an address referenced by a booking cannot be
  deleted (`409 CONFLICT`), so historical booking records keep their address.

## Availability & Scheduling Security (implemented — Milestone 7)

- **Access control**: public availability is unauthenticated by design; the
  technician endpoints require `requireAuth` + `requireRole('technician')` and a
  resolved technician profile. Customers and operations get `403`. Mutations
  require a CSRF token.
- **IDOR**: every technician query, update and delete carries
  `where: { id, technicianId }`. Another technician's slot returns the same
  `404` as a missing one — ownership is never revealed.
- **Mass assignment**: create/update bodies are `.strict()` — only
  `serviceSlug`, `startsAt`, `endsAt` are accepted. `technicianId`, `userId`,
  `status`, `bookingId` and any other key are rejected with `422`. The technician
  is taken from the session, never the body.
- **Service authorization**: a slot may only be created for a service that
  exists and is **active**; an inactive or unknown `serviceSlug` → `422`.
- **Timestamps**: instants must be ISO 8601 with an explicit offset; malformed or
  offset-less values → `422`. All logic is UTC; DST/local-time ambiguity cannot
  reach stored instants.
- **Unbounded queries**: the public window is bounded (default 14 days, max 62);
  past instants are always excluded regardless of `from`.
- **Internal-field exposure**: the public DTO is `{ id, startsAt, endsAt, durationMinutes }`
  only — no technician, user, service id, status, or timestamps.
- **Overlap / concurrency**: the PostgreSQL exclusion constraint is the
  authoritative guard; there is no race-prone application-level check. Concurrent
  overlapping creates are database-safe (tested).
- **Malformed identifiers**: `:id` is validated against `[A-Za-z0-9-]{8,64}`
  before any query.

## Service Pricing Security (implemented — Milestone 8)

- **The client never determines money.** `GET /api/v1/services/:slug/price`
  takes only a slug path param (Zod-validated). Any `subtotalCents`,
  `feesTotalCents`, `taxTotalCents`, `discountTotalCents`, `totalCents`,
  `currency`, or `basePriceCents` in the query string or body is ignored — the
  server reads the authoritative price from `Service` and computes the quote.
- **No mass assignment.** The endpoint is a pure read; there is no writable
  model and no `Booking` is created or touched.
- **Inactive services are not quotable.** The repository query is scoped
  `WHERE slug = ? AND active` → inactive or unknown slug returns `404`.
- **No internal-field leakage.** The response is the explicit `PriceQuote` DTO
  (7 fields); no raw Prisma object, no `id`, `active`, or `basePriceCents`.
- **Integer-cents arithmetic only.** `calculateServicePrice` uses integer
  addition/subtraction — no `parseFloat`, no division, no `Number` coercion of
  client input, no rounding.
- **Malformed slug → 422; unknown → 404**, so probing does not reveal whether a
  given slug exists as an inactive service.

## Booking Workflow Security (implemented — Milestone 9)

- **Access control**: `POST/GET/cancel /api/v1/bookings*` require `requireAuth` +
  `requireRole('customer')`; operations and technicians get `403`. Technician
  read endpoints require `requireRole('technician')` + a resolved profile.
  Mutations require a CSRF token (`403 CSRF_ERROR` without one).
- **IDOR**: every booking read, cancel and status-history query carries
  `where: { id, customerId }` (or `{ id, technicianId }`). Another user's
  booking id returns the same `404` as a missing one; a cross-customer list is
  empty. Booking `:id` is validated against `[A-Za-z0-9-]{8,64}` before any
  query.
- **Mass assignment**: the create body is `.strict()` — only `slotId`,
  `addressId`, `customerNotes` are accepted. `status`, `technicianId`,
  `customerId`, `serviceId`, `slotId` aside, `scheduledStart/End`, and every
  `price*` field are rejected with `422`. The customer is taken from the
  session; the technician, service, schedule and price come from the slot and
  the pricing calculation.
- **Client can never set a price**: all six snapshot figures plus the currency
  and breakdown are computed server-side inside the booking transaction and
  written to the immutable snapshot. A repriced service does not change an
  existing booking.
- **Address ownership**: booking with an `addressId` the caller does not own is
  a `422` on `addressId`, indistinguishable from an unknown address.
- **Inactive service / bad slot**: an inactive service (`422`), an unknown slot
  (`422`), a past slot (`422`), or an already-booked / non-`available` slot
  (`409`) cannot be booked.
- **Concurrency**: the `Booking.slotId` UNIQUE constraint is the authoritative
  guard. Two concurrent create attempts for the same slot produce exactly one
  booking (tested); there is no race-prone application-level check.
- **State machine**: transitions are checked against the documented table and
  the acting role in `@aisbp/shared`; an invalid transition (e.g. cancelling a
  cancelled booking) is `409`, never a silent no-op.
- **Data minimisation**: the customer DTO omits all user ids and the raw model;
  the technician DTO omits the price snapshot.

## Operations Dashboard Security (implemented — Milestone 10)

- **Access control**: every `/api/v1/operations/*` route is behind
  `requireAuth -> requireRole('operations')`. Unauthenticated -> `401`, customer
  or technician -> `403`. The status-change mutation also requires a CSRF token
  (`403 CSRF_ERROR` without one). Hiding the frontend route is never the control
  — the server rejects the request.
- **Broken access control / IDOR**: operations legitimately reads every booking,
  so there is no per-row owner check — but there is also no client-supplied
  owner id, filter, `select`, or `orderBy`. The booking `:id` is validated
  against `[A-Za-z0-9-]{8,64}` before any query; unknown -> `404`.
- **Mass assignment**: the status body is `.strict()` — only `status` and an
  optional `reason` are accepted, and `status` is constrained to the three
  operator-settable targets. `technicianId`, `priceTotalCents`,
  `changedByUserId`, `customerId`, etc. are rejected with `422`. The actor is
  taken from the session, never the body.
- **Invalid status transitions**: checked server-side against the shared state
  machine for the `operations` actor; a disallowed transition -> `409`, never a
  silent no-op. The booking status is never set to a value the machine forbids.
- **Concurrent status changes**: the change runs in a transaction with a
  conditional `updateMany` (status must still match what was read); a losing
  concurrent update -> `409`. Exactly one `BookingStatusHistory` row per applied
  change.
- **Arbitrary Prisma filtering / pagination abuse**: query params are Zod-parsed
  into an allow-list; `page`/`limit` are bounded (`limit` ≤ 100, `page` ≤ 1000)
  and out-of-range values are rejected, not clamped. `q` is a bounded
  case-insensitive substring, never a raw expression.
- **Sensitive data exposure**: the list DTO omits customer email, address, and
  the price breakdown. The detail DTO adds the customer email, address, and
  price snapshot — what an operator needs to act on a booking — but never a
  password hash, session data, `passwordHash`, timestamps beyond `createdAt`,
  or raw foreign keys (checked by tests).
- **Unbounded queries**: the dashboard uses `count` / `groupBy` aggregation
  only; the bookings table is never loaded into application memory.

## Technician Management & Assignment Security (implemented — Milestone 11)

- **Operations-only management**: every `/api/v1/operations/technicians*` route
  and the two `/api/v1/operations/bookings/:id/assign*` routes require
  `requireRole('operations')` — `401` unauth, `403` customer / technician.
  Mutations require CSRF.
- **Technician self-scope**: `/api/v1/technician/profile` and the technician job
  routes require `requireRole('technician')` + a resolved profile. Ownership is
  `user -> Technician.userId -> Technician.id -> Booking.technicianId`, enforced
  in every repository `where`. Reading, opening, or transitioning another
  technician's job returns the same `404` as a missing one — no enumeration. A
  technician cannot touch another technician's profile or qualifications (those
  routes are operations-only) and cannot manage their own record at all.
- **Never trust a client technician relationship**: the assign body is
  `.strict()` with only `{ technicianId, reason? }`; `status`, `slotId`,
  `changedByUserId`, `customerId`, `serviceId` are `422`. The technician is
  resolved and re-validated server-side (exists, active, qualified for the
  booking's service, no overlapping commitment) inside the transaction. The job
  status body is `.strict()` `{ status, reason? }` with `status ∈
{in_progress, completed}`.
- **Qualification integrity**: `serviceId` is validated server-side; the service
  must exist and be **active**. The DB `@@unique(technicianId, serviceId)` — not
  an application check — prevents duplicates (`409`). Removing a qualification
  cannot corrupt or hide historical bookings.
- **State machine**: assignment is only allowed from `confirmed` / `assigned`;
  job transitions are checked against the `technician` actor row. A forbidden
  transition is `409`, never a silent write. `BookingStatusHistory` is only ever
  written by the service, with the authenticated actor's id.
- **Concurrency**: `SELECT ... FOR UPDATE` on the target `Technician` serialises
  assignment with deactivation and qualification changes; conditional booking
  updates catch a concurrent booking-status change. Two concurrent assign
  attempts always leave one consistent assignment, never a corrupt booking. The
  price snapshot is never rewritten.
- **Data exposure**: technician DTOs carry `displayName` / `serviceArea` /
  `active` / linked user `name` + `email` (operations needs the identity) and
  qualification names — never a password hash, session, timestamps beyond
  `createdAt`, or raw foreign keys. The technician's own `profile` omits even the
  email. `:id` params are validated against `[A-Za-z0-9-]{8,64}` before any
  query.

## List Query Security (Milestone 12)

- Every list endpoint's `page` / `limit` / `sort` / filter params are parsed
  through a shared Zod contract. `page` and `limit` are bounded server-side
  (`limit` ≤ 50–100 per endpoint, `page` ≤ 1000); an out-of-range value is
  `422`, never silently clamped. `sort` and status filters are closed enums —
  an unknown value is `422`.
- Unknown query keys are ignored; no client-supplied `where`, `select`,
  `orderBy`, or field name ever reaches Prisma. The server builds the query from
  the allow-list only. (Verified: `?customerId=…&where[id]=…&select=password`
  returns the caller's own empty/normal page.)
- Adding pagination did not change any ownership check: the customer list is
  still `where: { customerId }`, the technician list `where: { technicianId }`,
  and operations lists remain role-gated. No DTO gained an internal field.
- `count` and the page query share one filter and one DB snapshot, so totals
  and pages are consistent and no unbounded query is issued.

## Cache Security (Milestone 13)

- **Only public data is cached.** The Redis read-through cache
  (`apps/api/src/lib/cache.ts`) is wired to exactly three unauthenticated
  catalogue endpoints (`GET /api/v1/categories`, `GET /api/v1/services`,
  `GET /api/v1/services/:slug`). No authenticated, customer-, technician-, or
  operations-scoped response is ever cached, so a cache read can never serve one
  user's data to another. `requireAuth`, `requireRole`, ownership `where`
  clauses, and CSRF are unchanged and still run on every request.
- **The cache never bypasses validation.** Keys are constructed _after_
  `catalogueQuerySchema` / the slug schema parse. A malformed request returns
  `422` before any cache access and creates no key (tested). A client cannot
  craft a query string that writes or probes an arbitrary Redis key: the key is
  `cache:catalogue:v1:` + a fixed set of validated fields, and a non-slug
  `:slug` skips the cache entirely.
- **No authorization decision is cached** — only catalogue DTOs. The stored
  envelope is re-parsed against the DTO's Zod schema on read; a value that does
  not match is discarded as a miss, so a poisoned or drifted entry cannot change
  the response shape or leak internal fields.
- **404s are not cached**, so probing `:slug` cannot learn (via timing or key
  existence) whether an inactive service exists — an unknown and an inactive
  slug are the same `404` as before.
- **Deactivation is eventually consistent, bounded by the TTL.** A service
  deactivated directly in the database can still be served from a cached `200`
  for at most 120 s (or until `catalogueService.invalidate()` runs). This is the
  documented cache window, not an indefinite exposure; after it the service
  `404`s and drops out of lists. Tested.
- **Redis is never a source of truth.** Booking state, price snapshots,
  technician assignment, ownership, and status transitions are read from
  PostgreSQL only. A Redis outage degrades every cached read to a direct
  PostgreSQL query rather than failing.
- Cache keys embed only public slugs and pagination integers — no user id,
  email, session id, or other identity.

## AI Assistant Security (Milestone 14)

- **Access control**: `/api/v1/ai/booking-assistant/*` requires `requireAuth` +
  `requireRole('customer')`; operations and technicians get `403`, anonymous
  `401`. A per-user Redis rate limit (`AI_RATE_LIMIT_MAX` per window) blunts
  cost abuse (`429`). All three routes are `POST` and require a CSRF token — the
  request triggers a paid external call, so a cross-site POST must not be able
  to spend a user's budget.
- **Claude output is untrusted input.** The forced-tool result is parsed with
  `aiBookingIntentSchema`; output that fails validation is discarded for a safe
  clarification fallback, never returned raw. Every field is then re-grounded:
  `serviceSlug` / `serviceCandidateSlugs` must be **active** service slugs;
  `addressId` must belong to the **caller** (checked against
  `repositories.addresses.listByUser`); `requestedDate` must be a well-formed
  future date. The model cannot surface an inactive service, another customer's
  address, or a fabricated one.
- **No mutation, no repository writes.** The endpoints only read (catalogue,
  the caller's addresses, public availability) and return a draft. Booking
  creation stays on `POST /api/v1/bookings` with its own transaction; a Claude
  suggestion is never the authority for a slot.
- **`priorIntent` is not trusted.** `clarify` accepts the previous `intent`
  object as context, but re-grounds every field, so a client cannot smuggle a
  foreign `addressId` or an unknown `serviceSlug` back through it (tested).
- **Data minimisation**: the prompt carries only active service `slug`/`name`,
  the caller's own address `id`/`label`/`city`, today's date, and the user's
  message. No booking history, no other addresses, no emails, no internal
  fields, no secrets.
- **Key handling**: `ANTHROPIC_API_KEY` is read from the environment
  server-side only and never logged or returned. With no key the endpoints
  return `503` and the rest of the API is unaffected.
- **Observability without leakage**: `ai.call` / `ai.validation` / `ai.error`
  log lines carry operation, model, latency, token counts, and outcome only —
  never prompt text, completion text, or personal data.

## Security & Performance Review (Milestone 16)

A full pass over `route → middleware → controller → service → repository →
database`, the AI flow, the M13 cache, and the frontend.

### Verified controls — no change needed

| Area                 | What was checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Result                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Authentication       | protected routers all start `requireAuth`; a forged / unknown session id → `401`; unknown-email and wrong-password give the same generic `401` with an equalising Argon2id verify; the session id and CSRF token live only in cookies (`HttpOnly` for the session)                                                                                                                                                                                                                                                                              | pass                                   |
| Authorization        | every owner-scoped repository query carries `where: { id, customerId }` / `{ id, technicianId }`; cross-owner access is a non-enumerating `404`; operations' table-wide reads have no client-supplied owner id / filter; role is taken from the session, never the body                                                                                                                                                                                                                                                                         | pass                                   |
| IDOR                 | customer → another customer's address / booking / status-history → `404`; technician → another technician's job / profile → `404`; `:id` params are `^[A-Za-z0-9-]{8,64}$`-validated before any query                                                                                                                                                                                                                                                                                                                                           | pass (covered by tests)                |
| CSRF                 | every `POST` / `PATCH` / `DELETE` across addresses, availability, bookings, operations status, technician management / qualifications / assignment, technician job status, and the AI assistant runs `requireCsrf`; `GET` is unaffected; single-origin CORS with credentials                                                                                                                                                                                                                                                                    | pass                                   |
| Mass assignment      | request bodies are `.strict()` Zod objects — `status`, `technicianId`, `customerId`, `serviceId`, `slotId`, `userId`, every `price*` field, `changedByUserId` are rejected with `422`                                                                                                                                                                                                                                                                                                                                                           | pass                                   |
| Arbitrary Prisma     | no `$queryRawUnsafe` / `$executeRawUnsafe` anywhere; the four `$queryRaw` sites are parameterised `SELECT … FOR UPDATE` locks; no client value ever reaches a Prisma `where` / `select` / `orderBy` / field name (sort and filter are closed enums; `q` is a bounded `contains`)                                                                                                                                                                                                                                                                | pass                                   |
| Data exposure        | every response is an explicit narrow `select`; no password hash, session data, `changedByUserId`, raw foreign key, or role-inappropriate field in any DTO (public catalogue / availability, customer booking, operations list & detail, technician list & detail & profile)                                                                                                                                                                                                                                                                     | pass (leak-string assertions in tests) |
| Booking integrity    | creation revalidates address ownership, slot availability, service active, technician active, and future-dated **inside the transaction**; the price snapshot is computed server-side in the same transaction; the initial `BookingStatusHistory` row is atomic; `Booking.slotId` UNIQUE is the double-booking authority (concurrent creates → exactly one, tested); status transitions use a conditional `updateMany` (concurrent change → `409`); assignment takes a `FOR UPDATE` lock on the technician and never touches the price snapshot | pass                                   |
| Database constraints | FKs (`RESTRICT` on booking→address/service/customer/slot, `SET NULL` on booking→technician, `CASCADE` on history→booking), `Booking.slotId` / `Technician.userId` / `TechnicianService(technicianId,serviceId)` / `AvailabilitySlot(technicianId,serviceId,startsAt)` UNIQUE, GiST slot-overlap `EXCLUDE`, positive-time and price CHECKs — all present; a referenced address / slot cannot be deleted (`409`)                                                                                                                                  | pass                                   |
| AI assistant         | user text is a bounded `.strict()` body; Claude output is `safeParse`d, and every field re-grounded server-side (invented service / foreign `addressId` / past date all dropped); the intent schema has no `status` / `technicianId` / `price` / `userId` keys, and Zod strips any the model adds; the assistant never calls a repository to mutate; a Claude error is a safe clarification (`200`), never a bypass; `503` when unconfigured                                                                                                    | pass (M14 + M16 tests)                 |
| Cache                | keyed `cache:catalogue:v1:…` — public catalogue only, no identity in the key; nothing authenticated is cached; a Redis failure is logged and falls through to PostgreSQL; TTL bounded (120 s)                                                                                                                                                                                                                                                                                                                                                   | pass                                   |
| Error handling       | expected errors → documented codes; unmapped errors (incl. unexpected Prisma errors) → generic `500` + a server-side log with method / path / message only; no stack trace, DB error, or provider error reaches a client                                                                                                                                                                                                                                                                                                                        | pass                                   |
| Frontend             | `ProtectedRoute` is UX-only and every sensitive operation is API-enforced; the UI renders only server-sanitised `ApiError.message` or its own generic fallback — no stack traces, DB errors, internal ids, or unnecessary emails                                                                                                                                                                                                                                                                                                                | pass                                   |

### Fixes applied (all with regression tests)

| Fix                    | Finding                                                                                                                                                                                                            | Change                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Slot floor             | no minimum slot length → a technician could create tens of thousands of sub-minute slots; every anonymous `GET /services/:slug/availability` then returned all of them (**88 ms** at a 12.5k-slot flood, measured) | `SLOT_MIN_MINUTES = 15` in `checkSlotTimes` — `422` on a shorter slot                                       |
| Unbounded availability | the public availability query had no `LIMIT`                                                                                                                                                                       | `AVAILABILITY_PUBLIC_MAX_SLOTS = 250` `take` — bounds the sort and the response payload                     |
| Deep pagination        | `page=10000` on the operations queue → `OFFSET ~200 000` → full sort, **~200 ms** measured                                                                                                                         | `PAGE_MAX` lowered `10_000 → 1_000` (still far past any UI); `422` beyond                                   |
| CSRF compare           | `!==` on the synchroniser token is not constant-time                                                                                                                                                               | `crypto.timingSafeEqual` (with a length guard)                                                              |
| Session trust          | `JSON.parse(raw) as SessionData` — `role` flows straight into `requireRole`                                                                                                                                        | the stored blob is `safeParse`d against a schema on read; an unknown `role` → treated as no session (`401`) |

### Accepted MVP tradeoffs (documented, not fixed)

- **Operations `q` search** does `name / email ILIKE '%…%'` across a join — a
  full `User` scan (**122 ms** at 20 000 users, measured). Operations-only, few
  trusted users, small user table for this domain. Scale-up: `pg_trgm` + GIN
  indexes (already the M12-deferred plan). Trigger: user table > ~50 000 rows
  or measured operations-search p95 above ~250 ms.
- **Dashboard aggregates** (`count(*)`, `groupBy status`) are full scans
  (**11–31 ms** at 30 000 bookings). Trigger: bookings table > ~hundreds of
  thousands of rows, then the M12-deferred `Booking(status, createdAt)`
  composite.
- **Rate limiter fails closed on a Redis outage** — `redis.incr` throwing
  surfaces as a `500` on login / register / AI. Acceptable: these are
  auth-adjacent and failing closed is the safe direction.
- **Redis is trusted for session content** beyond the shape check — if an
  attacker can write arbitrary `sess:` keys they can forge a _valid-shape_
  session for an existing user id. Mitigating this needs signed session blobs,
  out of MVP scope.
- **`booking: { is: null }` in the public availability query is redundant** with
  `status = 'available'` (M9 flips the slot to `booked`; `slotId` is UNIQUE;
  cancel does not revert). It is kept as defence-in-depth; dropping it would
  remove one hash-join (~5 ms) — an optional future simplification.

## API Validation

Use Zod schemas for:

- request params
- request query strings
- request bodies
- AI structured output
- environment variables

Invalid requests should return a consistent validation error without reaching business services.

## Booking And Pricing Integrity

- Booking creation must validate service, address ownership, slot availability, and price calculation in one controlled service flow.
- Final price fields and price breakdown must be stored on the booking.
- Historical bookings must never depend on mutable service price fields.
- Booking and slot updates must be transaction-safe to prevent double booking.

## AI Security

- Claude API keys stay server-side only.
- AI endpoints receive minimal necessary customer context.
- AI responses are validated before being used.
- AI must not directly write to the database.
- AI interaction logs must avoid raw secrets and unnecessary personal data.

## Secret Management

- `.env` files must not be committed.
- Provide `.env.example` later with placeholder values only.
- CI and deployment secrets should live in GitHub Actions or hosting provider secret stores.

## Error Handling (implemented)

- One error envelope everywhere: `{ "error": { "code", "message", "details"? } }`.
- Zod failures → `422 VALIDATION_ERROR` with per-field `details`. Unexpected
  errors → generic `500 INTERNAL`; the real error is logged server-side, never
  returned. No stack traces or provider errors reach the client.
- Stable codes the frontend handles: `VALIDATION_ERROR`, `INVALID_CREDENTIALS`,
  `UNAUTHENTICATED`, `FORBIDDEN`, `CSRF_ERROR`, `EMAIL_TAKEN`, `RATE_LIMITED`,
  `NOT_FOUND`, `INTERNAL`.
- The logger is a thin JSON console wrapper; passwords, session ids, cookies,
  and raw auth request bodies are never passed to it.

## Dependency Security

- Use lockfiles.
- Run dependency audits as part of regular maintenance.
- Keep production dependencies minimal.
