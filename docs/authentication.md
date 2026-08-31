# Authentication Strategy

This documents what is implemented, not aspirations.

## Approach

Email + password authentication with **server-side sessions stored in Redis**
and an **HttpOnly session cookie**. There is no token in JavaScript or
`localStorage`.

- Passwords hashed with **Argon2id** (`@node-rs/argon2`, m = 19 MiB, t = 2,
  p = 1 — OWASP baseline).
- Session id: 256 bits of CSPRNG randomness, base64url. Key `sess:<id>` in Redis
  holding `{ userId, role, csrfToken, createdAt }` with a TTL
  (`SESSION_TTL_SECONDS`, default 7 days).
- Session cookie (`SESSION_COOKIE_NAME`, default `aisbp.sid`): `HttpOnly`,
  `SameSite=Lax`, `Secure` in production (`COOKIE_SECURE`), `Path=/`.
- Sliding expiration: the TTL is refreshed on every authenticated request.

## Endpoints

| Method + path                | Auth           | Notes                                                          |
| ---------------------------- | -------------- | -------------------------------------------------------------- |
| `POST /api/v1/auth/register` | none           | Creates a `customer`, logs in, 201. Rate limited per IP.       |
| `POST /api/v1/auth/login`    | none           | 200 + new session. Rate limited per IP and per email.          |
| `POST /api/v1/auth/logout`   | session + CSRF | Destroys the session, clears cookies, 204.                     |
| `GET /api/v1/auth/me`        | session        | Returns `{ user: { id, email, name, role } }`. Never the hash. |

Registration only ever creates customers. Operations and technician accounts
are provisioned out of band (seed / future admin tooling).

## Session flow

```txt
register / login
  -> validate body (Zod)
  -> (login) verify Argon2id hash
  -> destroy any incoming session id           (session fixation defence)
  -> create a fresh session id + CSRF token in Redis
  -> set HttpOnly session cookie + readable CSRF cookie
  -> return the safe user view

authenticated request
  -> read session id from the cookie
  -> load session from Redis (401 if missing/expired)
  -> attach req.user = { id, role } and req.session
  -> refresh the Redis TTL

logout
  -> require a valid session and a matching CSRF token
  -> delete the Redis key, clear both cookies
```

## CSRF

Synchronizer token, transported as a double-submit cookie:

- On session creation the server stores a random `csrfToken` in the session and
  also sets a **readable** cookie (`CSRF_COOKIE_NAME`, default `aisbp.csrf`).
- The SPA echoes that value in the `X-CSRF-Token` header on every state-changing
  request.
- `requireCsrf` middleware (runs after `requireAuth`) rejects any unsafe method
  whose header does not match the session's token → `403 CSRF_ERROR`.
- `login` / `register` are not CSRF-protected: they have no session to act on
  and are guarded by `SameSite=Lax` plus credential entry.

## Authorization

Middleware in `apps/api/src/middleware`, reusable by every future route:

- `requireAuth` — 401 unless a valid session is present.
- `requireRole(...roles)` — 403 unless `req.user.role` is allowed.
- `requireResourceOwner(getOwnerId)` — customers may only touch their own
  resources; operations may touch any; a mismatch returns **404** (not 403) so
  resource existence is not revealed (IDOR defence).

Roles: `customer`, `operations`, `technician` (shared `roleSchema`, kept in sync
with the Prisma `Role` enum by a contract test).

The customer address endpoints (`/api/v1/addresses`, Milestone 6) use
`requireAuth` + `requireRole('customer')` and enforce per-row ownership in the
repository. Operations and technicians are not granted access to customer
addresses in this milestone.

## Brute-force protection

Fixed-window Redis counters:

- `POST /login`: `LOGIN_RATE_LIMIT_MAX` per window per IP, and the same per
  email.
- `POST /register`: `REGISTER_RATE_LIMIT_MAX` per window per IP.

Exceeding a limit returns `429 RATE_LIMITED` with `Retry-After`.

## User enumeration

- `login` returns the same `401 INVALID_CREDENTIALS` for an unknown email and a
  wrong password, and always performs an Argon2id verify (against a fixed dummy
  hash when the user is absent) so timing does not leak account existence.
- `register` returns `409 EMAIL_TAKEN` for a duplicate — a deliberate, accepted
  tradeoff for signup UX.

## Not in this milestone

Password reset, email verification, "remember me", account lockout beyond rate
limiting, refresh tokens, OAuth. Revisit only when a concrete requirement
appears.
