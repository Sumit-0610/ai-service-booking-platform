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

## Implementation (Milestone 14)

- **Client boundary**: `apps/api/src/lib/claude.ts` wraps `@anthropic-ai/sdk`
  behind a `ClaudeClient` interface (`extractStructured` / `generateText`). The
  AI service depends on the interface only; `setClaudeClientForTesting` injects
  a scripted fake so CI makes no real API call. `getClaudeClient()` returns
  `null` when `ANTHROPIC_API_KEY` is unset or `AI_ASSISTANT_ENABLED=false`;
  `intent` / `clarify` then return `503`, `availability` falls back to a
  template.
- **Model**: default `claude-sonnet-5` (`ANTHROPIC_MODEL`). `intent` / `clarify`
  use a **forced tool call** (`record_booking_intent`, `strict: true`) whose
  `input_schema` mirrors `aiBookingIntentSchema`.
- **Grounding**: `apps/api/src/modules/ai/ai-service.ts` re-validates every
  model-produced field against real records (active services, the caller's own
  addresses, a future calendar date). The model's `missingFields` and
  `clarificationQuestion` are advisory; the server recomputes `missingFields`
  deterministically (`missingIntentFields` in `@aisbp/shared`).
- **Fallback**: model output that fails `aiBookingIntentSchema`, or any Claude
  error, produces a safe clarification response (`confidence: "low"`,
  HTTP 200). No path mutates the database.
- **Availability**: slots always come from the availability service
  (PostgreSQL). Claude only writes the prose summary and only sees the slot
  list — never the booking rules.
- **Logging**: `ai.call` (model, latency, token counts), `ai.validation`
  (operation, outcome `ok` / `fallback`), `ai.error` (operation, message). No
  prompt or completion text.
- **Frontend**: `apps/web/src/features/ai-assistant` — a `/assistant` chat page
  (customer role). First message → `intent`, follow-ups → `clarify` with the
  last grounded intent; a complete intent offers a "Review & book" link to the
  normal service page.
