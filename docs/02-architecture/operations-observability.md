# Operations and Observability Baseline

Status: partial implementation, 2026-11-22.

## Health probes

- `GET /v1/health/live` confirms the HTTP process is serving requests. It does not call dependencies.
- `GET /v1/health/ready` runs `SELECT 1` against PostgreSQL and returns `503 SERVICE_UNAVAILABLE` if the database cannot be reached.
- Both routes pass through the correlation middleware and return the `X-Correlation-ID` header.

## Metrics

`GET /v1/metrics` exposes Prometheus text format with process-local request totals and cumulative request duration by bounded method/status labels. The scrape itself is excluded from request metrics. These counters reset when the process restarts and are not aggregated across replicas; configure scraping and aggregation before using them for service-level objectives.

## Tracing status

Structured request logs already carry the correlation ID. OpenTelemetry SDK/exporter instrumentation and distributed trace context propagation have not yet been added, so a correlation ID is not represented as an OpenTelemetry trace.

## Verification

The PostgreSQL E2E suite covers live response, healthy readiness, simulated database failure (503), metrics exposition and correlation headers. `npm run verify` checks build, unit tests and OpenAPI drift.
