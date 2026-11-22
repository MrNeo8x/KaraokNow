# Operations and Observability Baseline

Status: baseline implemented, 2026-11-22.

## Health probes

- `GET /v1/health/live` confirms the HTTP process is serving requests. It does not call dependencies.
- `GET /v1/health/ready` runs `SELECT 1` against PostgreSQL and returns `503 SERVICE_UNAVAILABLE` if the database cannot be reached.
- Both routes pass through the correlation middleware and return the `X-Correlation-ID` header.

## Metrics

`GET /v1/metrics` exposes Prometheus text format with process-local request totals and cumulative request duration by bounded method/status labels. The scrape itself is excluded from request metrics. These counters reset when the process restarts and are not aggregated across replicas; configure scraping and aggregation before using them for service-level objectives.

## Tracing

`be/src/instrumentation.ts` starts the OpenTelemetry Node SDK before NestJS modules load. HTTP, Express and PostgreSQL instrumentation are registered. The request middleware also extracts W3C `traceparent`, creates an HTTP server span, returns `X-Trace-ID` and adds `traceId`/`spanId` to the allowlisted request log.

Set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to the full traces URL, or `OTEL_EXPORTER_OTLP_ENDPOINT` to the collector base URL, to export spans over OTLP HTTP/protobuf. `OTEL_SERVICE_NAME` defaults to `karaokenow-backend`. With no endpoint, a no-op span processor preserves trace context and logs identifiers but drops spans; no collector is configured in this repository. The SDK shuts down through the Nest application lifecycle.

## Verification

The PostgreSQL E2E suite covers live response, healthy readiness, simulated database failure (503), metrics exposition, correlation headers and W3C `traceparent` round-trip. `npm run verify` checks build, unit tests and OpenAPI drift. OTLP transport against a running collector remains an environment-level verification.
