# Local Environment Check

Checked: 2026-11-22.

## Verified

- `.env` parses successfully and is ignored by Git.
- Required keys are present: `DATABASE_URL`, `POSTGRES_PORT`, `JWT_SECRET`, `PORT`.
- JWT secret satisfies the minimum 32-character validation rule.
- PostgreSQL URL, published port `5433` and Compose configuration agree.
- `docker compose config --quiet` succeeds.
- PostgreSQL 17 Alpine container reaches `healthy` state.
- Migrations through `003_auth_lifecycle` run successfully against the persistent local development database.
- Application environment validation succeeds.

## Scope

The current Compose file intentionally manages the local PostgreSQL dependency only. The NestJS backend still runs on the host through npm; a production/container image and full-stack Compose service are not yet implemented and must not be inferred from this check.

Migration discovery currently produces non-blocking timestamp warnings for both the legacy sequential names and the date-form occupancy migration. Applied history remains valid and is left unchanged. Future migrations should be generated through the project migration command using node-pg-migrate's supported epoch-prefix format rather than hand-named.
