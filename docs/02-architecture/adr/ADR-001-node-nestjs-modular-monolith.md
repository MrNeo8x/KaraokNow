# ADR-001: Node.js and NestJS Modular Monolith

- Status: Proposed baseline, currently implemented
- Date: 2026-11-22

## Context

The MVP requires strongly consistent booking transactions, a small initial team and several delivery channels. The repository started without application code. The original Spring Boot proposal has been explicitly replaced by Node.js and corresponding technologies.

## Decision

Use Node.js 24 LTS, TypeScript and NestJS as one modular monolith. Modules own controllers, application services and persistence queries, while sharing one PostgreSQL database. Provider integrations must sit behind adapters. PostgreSQL constraints, not process-local locks or Redis, enforce booking invariants.

Use `pg` for explicit parameterized SQL and `node-pg-migrate` for versioned migrations. This makes tenant predicates and PostgreSQL-specific booking constraints visible in code review.

## Consequences

- One deployable backend reduces MVP operational overhead.
- TypeScript can be shared conceptually across web, Zalo and backend teams.
- Explicit SQL requires disciplined mapping and integration tests.
- CPU-heavy work must run in workers or separate processes rather than block the Node.js event loop.
- A future service split is justified only by measured scaling, ownership or isolation needs.

## Guardrails

- No tenant-owned query without a tenant predicate.
- No payment/Zalo/Meta SDK in domain modules.
- No unapproved business default hidden in configuration.
- Booking, payment and refund state machines remain independent.

