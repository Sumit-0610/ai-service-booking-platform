# Security Strategy

## Principles

- Validate all external input.
- Authorize every protected operation.
- Treat AI output as untrusted input.
- Keep secrets out of source control.
- Use transactions for multi-record business mutations.
- Return safe errors to clients.

## Authentication Security

- Store password hashes only, never plaintext passwords.
- Use Argon2 or bcrypt with appropriate cost settings.
- Store session identifiers in HTTP-only secure cookies.
- Do not store tokens in localStorage.
- Rate limit login and registration endpoints.
- Invalidate sessions on logout.

## Authorization Security

- Role-based authorization must be enforced on backend routes.
- Customer resource ownership must be checked server-side.
- Technician endpoints must verify assignment before exposing booking details.
- Operations endpoints must be unavailable to customer and technician roles.

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

## Error Handling

- Do not expose stack traces in production responses.
- Log internal errors server-side with correlation IDs where possible.
- Return stable error codes that the frontend can handle.

## Dependency Security

- Use lockfiles.
- Run dependency audits as part of regular maintenance.
- Keep production dependencies minimal.
