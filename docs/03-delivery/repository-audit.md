# Repository Audit and MVP Gap Analysis

Audit date: 2026-11-22.

## Evidence-based inventory

| Area | Current evidence | Status |
|---|---|---|
| Backend runtime | NestJS bootstrap and modular module wiring | Implemented foundation |
| Database | PostgreSQL Compose service, first migration and Testcontainers verification | Implemented foundation; migration test passing |
| Authentication/RBAC | Password login/change, forced temporary change, short JWT, rotating refresh sessions, revocation, lockout, membership and branch grants | Implemented baseline; reset delivery and MFA pending |
| Branch management | Audited create/read/update/status API and tenant/branch authorization | Implemented baseline; amenities/media pending |
| Room management | Audited create/read/update/status API and tenant/branch authorization | Implemented baseline; amenities/media pending |
| OpenAPI | Swagger UI plus versioned 16-path JSON contract and CI drift check | Implemented baseline |
| Automated tests | Four Jest unit suites plus PostgreSQL HTTP/E2E coverage for identity, venue, occupancy and outbox recovery | Passing locally; full booking/concurrency coverage still absent |
| Availability | Audited maintenance-block CRUD/release over shared occupancy | Implemented foundation; availability search pending |
| Booking/holds | `tstzrange` occupancy and GiST no-overlap invariant | Schema proof implemented; hold workflow pending decisions |
| Payment/refund | No source files or provider adapter | Not implemented |
| Reception/customer web | No frontend workspace | Not implemented |
| Audit | Transactional audit schema and Owner read API | Implemented baseline |
| Outbox | Transactional schema, `SKIP LOCKED` dispatcher, retry/dead-letter states and stale-claim recovery | Implemented foundation; production process supervision/metrics pending |
| Notification | Adapter port, explicitly unconfigured runtime adapter and recording test adapter | Implemented boundary; no live provider connected |
| Health/readiness | Liveness endpoint and PostgreSQL `SELECT 1` readiness probe with 503 on failure | Implemented baseline |
| HTTP metrics | Prometheus exposition for process-local request counts and duration by method/status | Implemented baseline; counters reset on restart and are not aggregated |
| Webhook inbox | No schema or worker | Not implemented |
| CI/CD | GitHub Actions build, unit and E2E workflow | Implemented baseline; not yet observed on remote runner |
| HTTP observability | Correlation ID, standard errors, allowlisted structured request logs, health probes and basic metrics | Partial; OpenTelemetry instrumentation/context propagation pending |

“Partially implemented” means the code exists but the relevant Definition of Done is not yet satisfied. No external integration is represented as working.

## P0 gaps

1. Authentication lifecycle hardening: reset delivery/confirmation and MFA decision.
2. Room amenities/media and exported OpenAPI contract.
3. Approved pricing precedence and deterministic quote snapshots.
4. PostgreSQL occupancy model, maintenance blocks, hold expiry and concurrency proof.
5. Booking state transition policy and idempotent commands.
6. Payment abstraction, sandbox provider selection, webhook inbox and reconciliation.
7. Reception and customer web applications.
8. Production notification provider selection/adapter, outbox monitoring and operational recovery.
9. Broader contract, security and performance coverage.

## Immediate risks

- Local JWT authentication lacks reset, refresh/revocation, MFA and brute-force protection.
- Production dependency audit reports zero advisories; 27 moderate findings remain isolated to dev/test tooling and are documented.
- Venue migration and SQL mapping are integration-tested; later domains still need equivalent coverage.
- Product rules listed in the decision log can block pricing and booking design.
- CI workflow exists locally but has not yet been evidenced on a remote GitHub runner.

