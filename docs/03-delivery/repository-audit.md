# Repository Audit and MVP Gap Analysis

Audit date: 2026-11-22.

## Evidence-based inventory

| Area | Current evidence | Status |
|---|---|---|
| Backend runtime | NestJS bootstrap and modular module wiring | Implemented foundation |
| Database | PostgreSQL Compose service, first migration and Testcontainers verification | Implemented foundation; migration test passing |
| Authentication/RBAC | Password login/change, forced temporary change, short JWT, rotating refresh sessions, revocation, lockout, membership and branch grants | Implemented baseline; reset delivery awaits ZBS setup; MFA deferred until after pilot |
| Branch management | Audited create/read/update/status API and tenant/branch authorization | Implemented baseline |
| Room management | Audited create/read/update/status API and tenant/branch authorization; free-form amenities and metadata-only media CRUD are tenant/room scoped and audited | Implemented baseline; binary upload/fetch awaits storage decision |
| OpenAPI | Swagger UI, versioned 53-path JSON contract and generated frontend Markdown reference, with CI drift checks | Booking, quote, availability and hold snapshot schemas documented; other response schemas still missing |
| Automated tests | Eight Jest unit suites plus 31 PostgreSQL HTTP/E2E tests covering identity, venue, pricing, holds, no-deposit confirmation and worker recovery | Passing locally; 100 concurrent hold attempts tested; FE–BE browser verification and production benchmarks absent |
| Pricing | Tenant-scoped plans, special dates, rules, explicit priority, hourly/per-booking units, audited management, duration settings and quote API | Owner catalog APIs and quote implemented; no-deposit staff confirmation persists price snapshot |
| Availability | Audited maintenance-block CRUD/release, audited merchant buffer-policy API and tenant/branch-scoped availability search | Search excludes inactive branches/rooms and overlapping active occupancy; applies approved post-booking cleanup buffer. Search is not an atomic hold |
| Booking/holds | `tstzrange` occupancy and GiST no-overlap invariant; staff hold, contact/price snapshot, verification and atomic channel-authorized no-deposit confirmation | No-deposit staff baseline implemented; deposit calculation, case rules, deposit-required confirmation, later transitions and production supervision/alerts pending |
| Payment/refund | No source files or provider adapter | Not implemented |
| Reception/customer web | No frontend workspace | Not implemented |
| Audit | Transactional audit schema and Owner read API | Implemented baseline |
| Outbox | Transactional schema, `SKIP LOCKED` dispatcher, claim-token fencing, retry/dead-letter states, worker retry and tenant-scoped backlog | Local concurrent reclaim and worker shutdown E2E pass; provider idempotency and production supervision/alerts pending |
| Notification | Adapter port, explicitly unconfigured runtime adapter and recording test adapter | Implemented boundary; no live provider connected |
| Health/readiness | Liveness endpoint and PostgreSQL `SELECT 1` readiness probe with 503 on failure | Implemented baseline |
| HTTP metrics | Prometheus exposition for process-local request counts and duration by method/status | Implemented baseline; counters reset on restart and are not aggregated |
| OpenTelemetry | SDK started before Nest imports; HTTP spans, PostgreSQL instrumentation, W3C context, trace-aware logs and optional OTLP exporter | Implemented baseline; collector export not environment-tested |
| Webhook inbox | No schema or worker | Not implemented |
| CI/CD | GitHub Actions build, unit and E2E workflow | Implemented baseline; not yet observed on remote runner |
| HTTP observability | Correlation ID, standard errors, allowlisted structured request logs, health probes, basic metrics and trace context | Implemented baseline; OTLP collector delivery remains unverified |
| Requirement traceability | FR-001 through FR-015 mapped to current APIs, automated evidence and proposed UAT cases | Matrix implemented; UAT execution remains pending |

“Partially implemented” means the code exists but the relevant Definition of Done is not yet satisfied. No external integration is represented as working.

## P0 gaps

1. Complete ZBS password-reset delivery after OA/App/account/template setup; MFA is deferred until after pilot.
2. Complete deposit-required booking and later transitions, and verify expiry worker supervision and alerts in a deployed environment.
3. Booking state transition policy and idempotent commands.
4. Payment abstraction, sandbox provider selection, webhook inbox and reconciliation.
5. Reception and customer web applications.
6. Production notification provider selection/adapter, outbox monitoring and operational recovery.
7. Broader contract, security and performance coverage.

## Immediate risks

- ZBS reset delivery requires account/template setup; MFA is deferred until after pilot by PO decision.
- Production dependency audit reports zero advisories; 27 moderate findings remain isolated to dev/test tooling and are documented.
- Venue migration and SQL mapping are integration-tested; later domains still need equivalent coverage.
- Quote API implements approved PD-011/PD-019/PD-023; staff no-deposit confirmation persists the hold snapshot. Deposit-required confirmation and deployed expiry worker verification remain pending.
- CI workflow exists locally but has not yet been evidenced on a remote GitHub runner.

