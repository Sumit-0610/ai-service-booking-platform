# Milestone Plan

## Milestone 1: Planning And Documentation

Status: complete.

Deliverables:

- architecture documentation
- repository structure documentation
- domain and database model documentation
- API boundary documentation
- authentication and security strategy
- AI architecture documentation
- testing strategy
- performance strategy
- responsible AI-assisted development guidance

No user-facing application features should be implemented in this milestone.

## Milestone 2: Repository Scaffold

Deliverables:

- monorepo workspace setup
- frontend and backend app folders
- shared package folders
- TypeScript configuration
- linting and formatting
- Docker Compose for PostgreSQL and Redis
- GitHub Actions validation skeleton
- environment variable examples with placeholder values only

Stop for approval if scaffold tooling choices require changing the approved stack.

## Milestone 3: Backend Foundation

Deliverables:

- Express application bootstrap
- versioned API routing
- config validation
- centralized errors
- request validation helpers
- logging foundation
- health endpoint

No booking business features yet beyond structural foundation.

## Milestone 4: Database Foundation

Deliverables:

- Prisma schema for core entities
- migrations
- seed data
- database indexes
- transaction patterns documented in code where needed

Include first-class booking price snapshot fields.

## Milestone 5: Authentication And Authorization

Deliverables:

- register/login/logout/me endpoints
- secure password hashing
- HTTP-only cookie sessions
- Redis-backed sessions if selected during implementation
- role middleware
- customer ownership checks

## Milestone 6: Service Catalogue And Addresses

Deliverables:

- service categories
- services
- search, filtering, sorting, pagination
- customer address management

## Milestone 7: Availability And Pricing

Deliverables:

- technician availability slots
- availability lookup
- simple pricing service
- pricing breakdown response
- tests for price snapshot behavior

No complex pricing rules engine unless a concrete requirement is introduced.

## Milestone 8: Booking Lifecycle

Deliverables:

- create booking
- modify booking
- cancel booking
- booking history
- booking status timeline
- transaction-safe slot reservation
- stored booking price snapshot

## Milestone 9: Operations Workflows

Deliverables:

- operations dashboard
- booking search/filter/sort
- booking detail view
- technician management
- technician assignment
- operational analytics using real stored data only

## Milestone 10: Technician Workflows

Deliverables:

- assigned booking list
- booking detail view
- job status updates
- completion flow

## Milestone 11: AI Booking Assistant

Deliverables:

- Claude API backend integration
- structured intent extraction
- schema validation
- clarification questions
- service discovery assistance
- availability assistance
- booking preparation through normal services only

## Milestone 12: Quality, Deployment, And Polish

Deliverables:

- Playwright E2E coverage
- accessibility pass
- performance checks
- CI hardening
- deployment documentation
- final portfolio README
