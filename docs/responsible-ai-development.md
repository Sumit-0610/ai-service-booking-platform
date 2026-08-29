# Responsible AI-Assisted Development

## Positioning

This project is built with Codex as the primary coding assistant, but engineering ownership remains human-led. AI-generated code must be reviewed, tested, and validated before it is treated as production-quality work.

Do not claim that AI generated the entire project without engineering oversight.

## Development Standards

All AI-assisted changes must pass the same quality gates as hand-written code:

```txt
tests
type checking
linting
build
code review
```

## Review Expectations

AI-assisted code should be reviewed for:

- correctness
- security
- accessibility
- performance impact
- database consistency
- error handling
- maintainability
- unnecessary abstraction
- alignment with documented architecture

## Documentation Discipline

Architectural changes should update relevant docs. If implementation discovers a better approach, document the tradeoff rather than silently drifting from the plan.

## AI Feature Development

The product's Claude-powered booking assistant must follow stricter boundaries than ordinary code assistance:

- Claude does not directly modify the database.
- Claude output is validated with schemas.
- Business services remain authoritative.
- User confirmation is required before booking mutations.
- Sensitive user context is minimized.

## Security Reminder

Never commit secrets, real credentials, API keys, or private customer data. Use environment variables and placeholder examples only.

## Portfolio Honesty

It is appropriate to describe the project as AI-assisted development. It is not appropriate to present unchecked generated output as independently engineered production work.
