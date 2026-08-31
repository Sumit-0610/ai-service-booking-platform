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
