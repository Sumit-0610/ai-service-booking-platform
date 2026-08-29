# Authentication Strategy

## Goals

Authentication must be secure, understandable in a portfolio context, and compatible with a separate React frontend and Express backend.

## Recommended MVP Approach

Use email/password authentication with secure HTTP-only cookie sessions.

- Passwords are hashed with Argon2 or bcrypt.
- Session identifiers are stored in HTTP-only secure cookies.
- Server-side session data can be stored in Redis.
- The frontend never stores access tokens in localStorage.
- Protected routes use authentication middleware.
- Role-protected routes use authorization middleware.

## Roles

Supported roles:

- `customer`
- `operations`
- `technician`

Role checks should be explicit and centralized.

Middleware examples by responsibility:

```txt
requireAuth
requireRole
requireCustomerResourceOwnership
requireBookingAccess
```

## Session Flow

```txt
POST /api/v1/auth/login
-> validate credentials
-> verify password hash
-> create server-side session
-> set HTTP-only cookie
-> return user summary
```

```txt
GET /api/v1/auth/me
-> read session cookie
-> load current user
-> return user id, email, name, role
```

```txt
POST /api/v1/auth/logout
-> invalidate server-side session
-> clear cookie
```

## Authorization Rules

- Customers can access only their own addresses and bookings.
- Operations users can view and manage bookings, technicians, assignments, and operational metrics.
- Technicians can view only assigned bookings and update allowed job statuses.
- AI assistant endpoints run under the authenticated user context and inherit the same authorization rules as normal flows.

## CSRF And CORS

Because cookie sessions are recommended, mutation endpoints need CSRF protection. CORS must allow only the configured frontend origin in deployed environments.

## Alternatives Considered

JWT in localStorage is not recommended because it increases browser token exposure risk. Stateless JWTs may be revisited for mobile clients or third-party API consumers, but the MVP is a browser-based portfolio product.
