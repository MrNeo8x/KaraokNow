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

Rows left in `PROCESSING` for more than five minutes are returned to `PENDING` before the next claim. This covers a worker stopping after claim and before final status persistence. Delivery adapters must still be idempotent because a crash after provider acceptance but before `PUBLISHED` can cause redelivery.

## Notification boundary

`NotificationAdapter` accepts a channel, an opaque destination reference, a template identifier and template variables. The application default is `UnconfiguredNotificationAdapter`, which fails explicitly; it never reports a fake delivery. Automated tests replace it with a recording adapter.

No live provider, credential or external permission is included. Password-reset delivery must not be connected until the destination-reference and secret-handling design, approved channel and provider adapter are complete.

## Operational notes

- Run the worker separately from the HTTP process: `npm run outbox:work`.
- Monitor `PENDING` age, retry count and `DEAD` rows before production use.
- `last_error` stores only the error class, not provider responses or message data.
- `payload` must not contain raw passwords, access tokens or unnecessary personal data.
- Webhook inbox/idempotency is a separate future component and is not implemented here.

## Verification evidence

The PostgreSQL E2E suite verifies transaction rollback, durable commit despite provider failure, retry success and recovery of a stale claim. The repository verification command also covers compilation, unit tests and OpenAPI drift.
