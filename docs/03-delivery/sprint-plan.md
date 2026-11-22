# MVP Sprint Plan

Two-week sprints. Estimates and scope are subject to team refinement. No open business decision is silently converted into a default.

## Sprint 0 — Engineering foundation

Outcome: reproducible backend build and PostgreSQL schema verification.

- Node.js/NestJS project, Docker PostgreSQL and migration tooling.
- CI build/test/migration checks.
- OpenAPI generation and consistent error envelope.
- PostgreSQL integration-test harness.
- Dependency/security baseline and development runbook.

Exit evidence: clean install, TypeScript build, unit tests and migrations run against an isolated PostgreSQL database.

## Sprint 1 — Tenant, branch and room foundation

Outcome: an authorized merchant can manage its own branches and rooms without cross-tenant access.

- Tenant/user/membership/role schema and authentication decision.
- Branch and room create/read/update/status APIs.
- Unique branch/room codes and composite tenant FKs.
- Tenant isolation, validation, conflict mapping and audit tests.
- OpenAPI contract and traceability to FR-001, FR-002 and FR-011.

Exit evidence: tenant B receives no data from tenant A and cannot attach data to tenant A parents; tests run on PostgreSQL.

## Sprint 2 — Pricing model and room blocks

Outcome: deterministic quotes and maintenance availability inputs.

Blocked until PO approves duration increments, buffer rules and pricing precedence. Implement versioned price plans/rules, special dates, room blocks and quote snapshots only after those decisions.

## Sprint 3 — Availability and atomic holds

Outcome: availability and holds share a database-enforced no-overlap invariant.

- `tstzrange` occupancy and GiST exclusion constraint.
- `[start,end)` interval rules, maintenance conflicts and hold expiry.
- Idempotent hold API and 100-request concurrency test.

## Sprint 4 — Booking lifecycle and reception core

Outcome: reception can create, confirm where permitted, check in and check out bookings through explicit transitions.

## Sprint 5 — Payment sandbox and web booking

Outcome: selected sandbox payment adapter can confirm a valid hold idempotently; customer web completes the approved flow.

Blocked on provider, merchant-of-record and deposit decisions.

## Sprint 6 — Cancellation, refund and reception UX

Outcome: approved cancellation policy snapshots drive auditable cancellation/refund handling.

## Sprint 7 — Outbox notifications, reporting and pilot hardening

Outcome: provider failures do not roll back bookings, operations can reconcile and pilot metrics are observable.

## Sprint 8 — Release gates

Outcome: E2E, security, concurrency, performance, backup/recovery and merchant UAT gates have executable evidence.

