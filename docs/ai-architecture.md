# AI Architecture

## Purpose

The AI Booking Assistant helps customers express booking needs in natural language. It supports service discovery, booking intent extraction, availability questions, clarification questions, and booking preparation.

The normal application remains responsible for every mutation.

## Hard Boundary

Claude must not directly modify the database.

Required flow:

```txt
User
-> React AI interface
-> backend AI service
-> Claude
-> structured intent
-> schema validation
-> normal business rules
-> availability validation
-> existing booking service
-> database
```

## Example Intent

User message:

```txt
I need my washing machine installed next Saturday at my home.
```

Expected structured intent:

```json
{
  "service": "washing-machine-installation",
  "requestedDate": "resolved-date-value",
  "addressRequired": true
}
```

## Backend Responsibilities

The backend AI module should:

- authenticate the user
- collect minimal relevant context
- call Claude with constrained instructions
- request structured JSON output
- validate Claude output with Zod
- map service names to real service records
- ask clarification questions when required fields are missing
- call normal services for availability checks and booking preparation

## Claude Responsibilities

Claude may:

- extract structured booking intent
- suggest likely service matches
- identify missing details
- draft clarification questions
- summarize availability options from backend-provided slots

Claude must not:

- create bookings
- update bookings
- create or update addresses
- assign technicians
- change booking status
- calculate final authoritative prices
- bypass authorization or availability rules

## Data Minimization

Prompts should include only what is needed for the immediate task. Avoid sending full booking histories, unrelated addresses, secrets, internal notes, or operational-only data.

## Validation

All AI output is untrusted. The backend must validate:

- JSON shape
- enum values
- date parseability
- service slug matching
- missing required fields
- confidence or ambiguity where represented

Invalid output should produce a clarification or safe fallback, not a database mutation.

## Pricing And AI

Claude can help explain or prepare pricing context, but the authoritative price must come from the backend pricing service. When a booking is created or modified, the final agreed price and breakdown must be stored on the booking.

## Observability

AI calls should log safe metadata such as:

- request type
- model name
- latency
- validation success or failure
- token usage if available

Do not log sensitive raw prompts or responses by default.
