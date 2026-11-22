# Transactional Outbox and Notification Boundary

Status: implemented foundation, 2026-11-22.

## Purpose and scope

The outbox persists a side-effect request in the same PostgreSQL transaction as the domain change. A committed domain change therefore does not depend on an external notification provider being available. This foundation does not claim that email, SMS or Zalo delivery is configured.

## Write and delivery flow

1. A domain service opens a PostgreSQL transaction.
2. It writes the domain change and calls `OutboxService.enqueue` with the same `PoolClient`.
3. Commit makes both records visible; rollback removes both records.
4. A separate process started with `npm run outbox:work` claims available rows using `FOR UPDATE SKIP LOCKED`.
5. The worker invokes the adapter registered for `NOTIFICATION_ADAPTER`.
6. Successful work becomes `PUBLISHED`. Failed work returns to `PENDING` with exponential backoff and becomes `DEAD` after five attempts.

Rows left in `PROCESSING` for more than five minutes are returned to `PENDING` before the next claim. Each claim has a token; final status updates require the current token, so a worker finishing an obsolete claim cannot overwrite a newer claim's outcome. This does not prevent duplicate calls to an external provider: delivery adapters must be idempotent because a crash, delayed response or stale recovery after provider acceptance can cause redelivery.

## Notification boundary

`NotificationAdapter` accepts a channel, an opaque destination reference, a template identifier and template variables. The application default is `UnconfiguredNotificationAdapter`, which fails explicitly; it never reports a fake delivery. Automated tests replace it with a recording adapter.

No live provider, credential or external permission is included. Password-reset delivery must not be connected until the destination-reference and secret-handling design, approved channel and provider adapter are complete.

## Operational notes

- Run the worker separately from the HTTP process: `npm run outbox:work`.
- Worker loop retries transient batch/database errors with backoff capped at 30 seconds and emits redacted error/recovery events. SIGINT/SIGTERM stops new polling and lets the current batch finish before closing the database pool.
- Owner can call `GET /v1/merchant/notifications/outbox/backlog` for tenant-scoped pending, processing and dead counts and oldest ready pending age. It excludes payloads and recipients and is not a worker heartbeat; production monitoring, thresholds and process supervision still need environment-specific setup.
- For migration `20261123050000_outbox_claim_token`, stop old outbox workers before migrating and restart only the updated worker version. Old workers do not respect claim tokens and can overwrite newer claims. Existing PROCESSING rows without tokens are recovered when their claim becomes stale.
- `last_error` stores only an allowlisted standard error name or `DeliveryError`, not arbitrary provider error names, responses or message data.
- `payload` must not contain raw passwords, access tokens or unnecessary personal data.
- Webhook inbox/idempotency is a separate future component and is not implemented here.

## Verification evidence

The PostgreSQL E2E suite verifies rollback, durable commit despite provider failure, retry success, stale claim recovery, fencing of an obsolete worker, provider error redaction, owner-only backlog and a separate worker process shutting down with the unconfigured adapter. Unit tests cover loop retry and shutdown. Production deployment and provider delivery remain unverified.
