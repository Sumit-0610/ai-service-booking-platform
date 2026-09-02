# Testing Strategy

## Goals

Testing should prove the core booking platform works, protect security boundaries, and keep AI-assisted flows deterministic under test.

## Backend Tests

Use Vitest for backend unit and integration tests.

Unit test focus:

- booking state transitions
- pricing snapshot calculation
- slot availability checks
- technician assignment rules
- authorization helpers
- Zod validation schemas
- AI output validation and fallback behavior

Integration test focus:

- auth endpoints
- customer booking creation
- booking modification and cancellation
- operations assignment flow
- technician status update flow
- error response consistency
- transaction behavior around booking slots

AI tests (implemented — Milestone 14, `apps/api/src/modules/ai/ai.integration.test.ts`):

- a scripted fake `ClaudeClient` is injected (`setClaudeClientForTesting`) —
  real Claude is never called in CI or local tests
- successful structured intent extraction and service/address/date grounding
- an invented service slug, an unowned `addressId`, and a past date are all
  dropped into `missingFields`
- malformed model output and a thrown Claude error both produce a safe
  clarification (HTTP 200), not a 5xx
- `clarify` re-grounds the client-supplied `priorIntent` (no smuggled address)
- `503` when the assistant is unconfigured; auth (`401`), role (`403`), CSRF
  (`403`), body validation (`422`), and per-user rate limit (`429`)
- booking and address counts are unchanged after a batch of assistant calls
- `availability` returns real slots with only the public DTO fields, and still
  answers (from a template) when the assistant is off

## Frontend Tests

Use React Testing Library for component and route behavior.

Coverage focus:

- auth forms
- protected routes by role
- service search/filter/sort UI
- address forms
- booking flow forms
- pricing breakdown display
- booking history and status timeline
- operations dashboard filters
- technician assigned booking views
- AI assistant intent and clarification states

## End-to-End Tests

Use Playwright for complete user journeys.

Core journeys:

- customer registers, adds address, books a service, sees price breakdown
- customer cancels an eligible booking
- operations user assigns a technician
- technician starts and completes a job
- role access restrictions prevent unauthorized views
- AI assistant prepares booking intent but requires normal confirmation

## CI Validation

The GitHub Actions pipeline should eventually run:

```txt
lint
typecheck
unit tests
integration tests
frontend tests
build
e2e smoke tests
```

## Test Data

Seed data should be realistic but small:

- service categories
- active services with simple prices
- customers
- operations user
- technicians
- availability slots
- sample bookings in different statuses

## Non-Goals For MVP

Do not build fragile tests around exact visual layout. Prefer behavior, accessibility, and user outcomes.
