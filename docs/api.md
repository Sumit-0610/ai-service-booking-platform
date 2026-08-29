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

Pagination query parameters:

```txt
page
pageSize
sort
order
```

Filtering should use explicit query parameters rather than unstructured ad hoc filters.

Standard error shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": []
  }
}
```

## Public Endpoints

```txt
GET /api/v1/service-categories
GET /api/v1/services
GET /api/v1/services/:serviceId
GET /api/v1/availability
```

Capabilities:

- Browse active service categories.
- Browse/search/filter/sort active services.
- View service details.
- Check available slots by service, date range, and location context where applicable.

## Authentication Endpoints

```txt
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

Responsibilities:

- Register customers.
- Authenticate users.
- Clear sessions.
- Return current user and role context.

## Customer Endpoints

```txt
GET    /api/v1/addresses
POST   /api/v1/addresses
PATCH  /api/v1/addresses/:addressId
DELETE /api/v1/addresses/:addressId
```

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
