# Dependency Security Audit

Audit date: 2026-11-22.

## Executed checks

- `npm audit --omit=dev --audit-level=moderate`: 0 production vulnerabilities, including after adding OpenTelemetry runtime packages.
- npm install audit summary: 27 moderate findings; no high or critical findings reported.

## Triage

All reported findings are in development, build, migration or test tooling. The affected direct tool dependencies are Jest 30, Nest CLI 11, Testcontainers 11 and node-pg-migrate 8. Their transitive findings include `glob`, `minimatch`, `uuid`, `dockerode` and coverage/archive packages.

npm proposes major-version changes, including Jest 30 → 29, Nest CLI 11 → 12 and Testcontainers 11 → 12. These are not safe unattended patches and `npm audit fix --force` was deliberately not run.

## Disposition

- Production runtime risk from the current audit: none reported.
- CI/dev-tool risk: accepted temporarily with no untrusted glob patterns, archives or test inputs executed in privileged production environments.
- Reassess during dependency maintenance; upgrade each direct tool independently with build, migration and E2E verification.
- CI should run `npm audit --omit=dev` as the release-blocking check. Full dev audit remains informational until compatible fixes are validated.
