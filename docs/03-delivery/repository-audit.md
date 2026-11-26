# Repository Audit and MVP Gap Analysis

Audit date: 2026-11-26.

## Evidence-based inventory

| Area | Current evidence | Status |
|---|---|---|
| Backend runtime | NestJS bootstrap and modular module wiring | Implemented foundation |
| Database | PostgreSQL Compose service, first migration and Testcontainers verification | Implemented foundation; migration test passing |
| Authentication/RBAC | Password login/change, forced temporary change, short JWT, rotating refresh sessions, revocation, lockout, membership and branch grants; global `platform_admins` grant with `PlatformAdminGuard` | Implemented baseline; reset delivery awaits ZBS setup; MFA deferred until after pilot |
| Branch management | Audited create/read/update/status API and tenant/branch authorization | Implemented baseline |
| Room management | Audited create/read/update/status API and tenant/branch authorization; free-form amenities and metadata-only media CRUD are tenant/room scoped and audited | Implemented baseline; binary upload/fetch awaits storage decision |
| OpenAPI | Swagger UI, versioned 73-path JSON contract and generated frontend Markdown reference, with drift checks | Booking lifecycle, hold deposits, platform listing/merchant APIs, public catalog/hold/lookup documented; some older response schemas still missing |
| Automated tests | Ten Jest unit suites (42 tests) plus 38 PostgreSQL HTTP/E2E tests (identity, venue, pricing, holds, deposits, confirmation, check-in/out, cancellation/no-show, workers, calendar, CASH, public flows, Platform Admin, deterministic per-room lock regression); reproducible booking benchmark `npm run bench:booking` (QA-002); FE Playwright browser scripts in `fe/e2e` | Passing locally on 2026-11-26; benchmark meets p95 targets on a local machine; staging benchmark, Branch Manager/Cashier browser runs and UAT execution pending |
| Pricing | Tenant-scoped plans, special dates, rules, explicit priority, hourly/per-booking units, audited management, duration settings and quote API | Implemented; price snapshot persisted on hold and booking |
| Availability | Audited maintenance-block CRUD/release, audited merchant buffer-policy API and tenant/branch-scoped availability search | Search excludes inactive branches/rooms and overlapping active occupancy; applies approved post-booking cleanup buffer. Search is not an atomic hold |
| Booking/holds | `tstzrange` occupancy and GiST no-overlap invariant; staff/public holds with price + deposit-policy snapshot, verification, confirmation (no-deposit or deposit-covered), check-in, check-out (early departure shortens occupancy, PD-025) and staff-reviewed cancellation/no-show (PD-027) | Implemented for pilot scope; overtime, case-level eligibility and production worker supervision/alerts pending |
| Payment/refund | Audited/idempotent manual CASH on bookings, CASH deposits on holds with snapshotted required amount, staff-recorded refund on cancellation outcome | Partial; no reversal/correction, amount-due reconciliation, deposit refund on hold expiry or provider adapter |
| Reception/customer web | FE staff flows, public `/booking` guest hold/lookup (committed); deposits, check-in/out, cancellation, `/platform` and merchant admin screens in progress in FE working tree | Partial; browser FE–BE role verification not run |
| Audit | Transactional audit schema and Owner read API; platform decisions and merchant creation audited on the target tenant | Implemented baseline; no cross-tenant platform audit view |
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
2. PO decisions on overtime and cash reconciliation (amount due vs paid, corrections, deposit refund on expiry); then implement.
3. Verify expiry/outbox worker supervision and alerts in a deployed environment.
4. Run browser FE–BE role verification and UAT for reception, customer and Platform Admin flows.
5. Payment abstraction, provider selection, webhook inbox and reconciliation (post-pilot, PD-007).
6. Production notification provider selection/adapter, outbox monitoring and operational recovery.
7. Backup/restore drill (OPS-002), pool/timeout limits (OPS-004) and a staging re-run of the QA-002 benchmark.

## Immediate risks

- ZBS reset delivery requires account/template setup; MFA is deferred until after pilot by PO decision.
- Production dependency audit reports zero advisories; 27 moderate findings remain isolated to dev/test tooling and are documented.
- Venue migration and SQL mapping are integration-tested; later domains still need equivalent coverage.
- Quote API implements approved PD-011/PD-019/PD-023; confirmation persists price, deposit-policy and terms snapshots. Deployed expiry worker verification remains pending; local Docker compose does not run the workers.
- CI workflow exists locally but has not yet been evidenced on a remote GitHub runner.

