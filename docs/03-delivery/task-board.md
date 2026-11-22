# KaraokeNow MVP Task Board

Last updated: 2026-11-22. This file is the repository source of truth for implementation work. Product decisions remain in `docs/00-product/decision-log.md`.

## Workflow

Statuses:

- `DONE`: implementation and required automated evidence exist.
- `IN_PROGRESS`: actively being implemented; one task at a time unless work is independent.
- `READY`: refined enough to start and has no unresolved dependency.
- `BLOCKED`: cannot be implemented without an explicit decision or external prerequisite.
- `BACKLOG`: valid work, not yet ready or prioritized.

A task moves to `DONE` only when code review, build, relevant tests, migration/API documentation, authorization and audit requirements are satisfied. A passing unit test alone is not sufficient for database or concurrency behavior.

## Current delivery snapshot

| ID | Task | Module | Sprint | Priority | Status | Dependencies | Completion evidence |
|---|---|---|---:|---|---|---|---|
| FND-001 | Node.js/NestJS modular monolith foundation | Platform | 0 | P0 | DONE | — | `npm run build` passes |
| FND-002 | PostgreSQL migrations and isolated integration harness | Platform | 0 | P0 | DONE | FND-001 | Testcontainers migration tests pass |
| FND-003 | Backend CI build, unit and E2E workflow | Platform | 0 | P0 | DONE | FND-001, FND-002 | `.github/workflows/backend-ci.yml` |
| IAM-001 | Password login and signed JWT identity | Identity | 1 | P0 | DONE | FND-002 | Valid/invalid login E2E tests |
| IAM-002 | Tenant membership, roles and branch grants | Identity | 1 | P0 | DONE | IAM-001 | Cross-tenant and branch-scope E2E tests |
| IAM-003 | Owner membership management API | Identity | 1 | P0 | DONE | IAM-002 | Create/deactivate membership E2E tests |
| VEN-001 | Branch CRUD/status with soft delete | Venue | 1 | P0 | DONE | IAM-002 | PostgreSQL HTTP tests and audit records |
| VEN-002 | Room CRUD/status with soft delete | Venue | 1 | P0 | DONE | VEN-001 | PostgreSQL HTTP tests and audit records |
| AUD-001 | Transactional audit log and Owner read API | Platform | 1 | P0 | DONE | IAM-002 | Mutation and audit-query E2E tests |
| SEC-001 | Dependency vulnerability triage | Security | 1 | P0 | DONE | — | 0 production advisories; dev-tool findings and disposition in `docs/04-quality/dependency-security-audit.md` |
| IAM-004 | Password change, reset-token workflow and forced temporary-password change | Identity | 1 | P0 | IN_PROGRESS | IAM-001; reset delivery needs NTF-001 | Forced change and session revocation pass; hashed reset schema exists; delivery/confirmation not exposed |
| IAM-005 | Refresh token rotation, logout/revocation and session inventory | Identity | 1 | P0 | DONE | IAM-001 | Rotation, family reuse detection, logout and inactive-session E2E tests pass |
| IAM-006 | Login rate limit and lockout protection | Identity | 1 | P0 | DONE | IAM-001 | PostgreSQL-backed fifth-failure lockout and security-event E2E tests pass |
| API-001 | Standard API error envelope and correlation ID | Platform | 1 | P0 | DONE | FND-001 | Unit/E2E tests cover validation, auth, conflict, internal redaction and correlation propagation |
| API-002 | Export and version OpenAPI contract | Platform | 1 | P0 | DONE | API-001 | 16-path `openapi.json`, bearer/tenant schemes and CI drift check pass |
| VEN-003 | Room amenities and media metadata | Venue | 1–2 | P0 | READY | VEN-002 | Tenant-scoped CRUD and validation tests; object upload excluded until storage decision |
| OBS-001 | Structured logs with secret/PII redaction | Platform | 1 | P0 | DONE | API-001 | Allowlist logger excludes body, query, Authorization and password; redaction unit test passes |
| PRC-001 | Approve duration increment and min/max duration | Product | 2 | P0 | BLOCKED | PD-001 | PO decision recorded in decision log |
| PRC-002 | Approve pricing precedence and rounding | Product | 2 | P0 | BLOCKED | New PO decision | Examples and edge cases approved |
| PRC-003 | Price plan/rule/special-date schema | Pricing | 2 | P0 | BLOCKED | PRC-001, PRC-002 | Migration and precedence tests |
| PRC-004 | Deterministic quote API and immutable snapshot contract | Pricing | 2 | P0 | BLOCKED | PRC-003 | Golden-case unit and PostgreSQL integration tests |
| AVL-001 | Approve booking buffer calculation | Product | 2 | P0 | BLOCKED | PD-002 | PO decision recorded |
| AVL-002 | Maintenance room-block CRUD | Availability | 2 | P0 | DONE | VEN-002 | Audited create/read/update/release with assigned-branch and overlap E2E tests |
| AVL-003 | Availability query excluding inactive/maintenance/occupied rooms | Availability | 3 | P0 | BLOCKED | AVL-001, PRC-003 | API integration and benchmark dataset tests |
| BKG-001 | Approve hold TTL by channel | Product | 3 | P0 | BLOCKED | PD-003 | PO decision recorded |
| BKG-002 | Occupancy schema with `tstzrange` and GiST exclusion constraint | Booking | 3 | P0 | DONE | FND-002 | Shared maintenance/booking occupancy; adjacent/overlap/release PostgreSQL tests pass |
| BKG-003 | Atomic idempotent hold API and expiry worker | Booking | 3 | P0 | BLOCKED | BKG-001, BKG-002, AVL-003 | Hold/expiry/retry integration tests |
| BKG-004 | 100-concurrent-request hold correctness test | Booking | 3 | P0 | BLOCKED | BKG-003 | At most one active hold for one room/time |
| BKG-005 | Booking state machine and transition authorization | Booking | 4 | P0 | BLOCKED | BKG-003, PD-005, PD-008 | Illegal transition and role tests |
| REC-001 | Reception calendar API | Reception | 4 | P0 | BLOCKED | BKG-005 | Branch-scoped listing and pagination tests |
| REC-002 | Reception web application foundation | Frontend | 4 | P0 | BACKLOG | API-002, REC-001 | Accessible loading/error/empty states and E2E smoke test |
| PAY-001 | Approve provider and merchant-of-record model | Product | 5 | P0 | BLOCKED | PD-007 | PO/legal decision recorded |
| PAY-002 | Payment provider port and sandbox adapter | Payment | 5 | P0 | BLOCKED | PAY-001, PD-004 | Sandbox contract tests; no production credentials |
| PAY-003 | Webhook inbox, signature verification and idempotency | Payment | 5 | P0 | BLOCKED | PAY-002 | Same webhook five times causes one effective transition |
| PAY-004 | Late-payment reconciliation path | Payment | 5 | P0 | BLOCKED | PAY-003, BKG-005 | Expired hold is never automatically confirmed |
| WEB-001 | Customer booking web foundation | Frontend | 5 | P0 | BACKLOG | API-002, AVL-003, PRC-004 | Mobile-first accessible browse-to-hold flow |
| CAN-001 | Approve cancellation/refund/no-show policy | Product | 6 | P0 | BLOCKED | PD-006 | Versioned policy examples approved |
| CAN-002 | Cancellation policy snapshot and refund workflow | Booking/Payment | 6 | P0 | BLOCKED | CAN-001, PAY-003 | Authorization, audit and retry tests |
| EVT-001 | Transactional outbox schema and dispatcher | Platform | 7 | P0 | DONE | FND-002 | Migration applies on existing DB; E2E covers rollback, committed event, retry and stale-claim recovery |
| NTF-001 | Notification port and non-live test adapter | Notification | 7 | P0 | DONE | EVT-001 | Explicitly unconfigured production adapter plus recording test adapter; provider failure leaves committed domain transaction intact |
| OPS-001 | Health/readiness, metrics and OpenTelemetry baseline | Operations | 7 | P0 | IN_PROGRESS | FND-001 | Liveness, DB readiness, Prometheus process-local HTTP metrics and correlation E2E pass; OpenTelemetry SDK/exporter and trace-context propagation remain |
| QA-001 | FR → API → automated test → UAT traceability matrix | Quality | 7 | P0 | READY | API-002 | FR-001 through FR-015 mapped without unsupported claims |
| QA-002 | Booking performance and concurrency suite | Quality | 8 | P0 | BLOCKED | BKG-004 | Documented benchmark and reproducible results |
| OPS-002 | Backup/restore and recovery drill | Operations | 8 | P0 | BACKLOG | Production environment design | Measured RPO/RTO drill report |
| UAT-001 | Merchant pilot workflow and UAT checklist | Quality/Ops | 8 | P0 | BACKLOG | REC-002, WEB-001, PAY-003 | Five merchants validate approved workflows |
| ZAL-001 | Verify Zalo Mini App permissions and current SDK compatibility | Channel | Pilot | P1 | BLOCKED | External platform approval | Written verification; no integration claim before approval |
| META-001 | Verify Meta permissions and web/deep-link approach | Channel | Pilot | P1 | BLOCKED | External platform approval | Written verification; no integration claim before approval |

## Recommended execution queue

Work in this order while product decisions are being resolved:

1. Complete `IAM-004` reset request/confirmation against the outbox boundary; keep real delivery blocked until a channel/provider and secret-handling design are approved.
2. Complete OpenTelemetry SDK/exporter and trace-context propagation for `OPS-001`.
3. Start `QA-001` traceability matrix while product decisions are pending; begin `PRC-003`/`PRC-004` only after `PRC-001` and `PRC-002` are approved.

## Decision queue for PO/BA

| Order | Decision | Needed by | Related task |
|---:|---|---|---|
| 1 | Booking duration increments and min/max | Sprint 2 | PRC-001 |
| 2 | Pricing precedence, rounding and special-date override | Sprint 2 | PRC-002 |
| 3 | Setup/cleanup buffer | Sprint 2–3 | AVL-001 |
| 4 | Hold TTL per channel | Sprint 3 | BKG-001 |
| 5 | No-deposit and walk-in confirmation rules | Sprint 4 | BKG-005 |
| 6 | Payment provider and merchant-of-record | Sprint 5 | PAY-001 |
| 7 | Deposit calculation | Sprint 5 | PAY-002 |
| 8 | Cancellation/refund/no-show policy | Sprint 6 | CAN-001 |

## Update protocol

When changing a task:

1. Update its status and dependencies in this file.
2. Add links to migrations, APIs and tests in “Completion evidence” when marking `DONE`.
3. Record product approvals in the decision log, not only in this board.
4. Update the repository audit when a module changes from missing to implemented.
5. Never mark external providers, performance targets or release gates complete without executed evidence.

