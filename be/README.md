# KaraokeNow

The backend implements authentication and membership, tenant-scoped branch and room management, maintenance blocks, pricing quotes, availability search, staff/public holds, hold deposits, confirmation, check-in/out, cancellation/no-show, manual CASH payments, public catalog and Platform Admin listing approval/merchant onboarding. Online payment and live channel integrations are out of pilot scope. See `../docs/03-delivery/task-board.md` for current status and `../AGENTS.md` for agent conventions.

## Run locally

Requirements: Node.js 24+ (local verification used Node 26), npm and Docker.

```bash
docker compose up -d postgres
npm ci
cp .env.example .env
# Replace JWT_SECRET in .env with a private value of at least 32 characters.
npm run db:migrate
npm run start:dev
```

The application loads `.env` automatically and validates `DATABASE_URL`, `JWT_SECRET` and `PORT` at startup. Real `.env` files are ignored by Git; update `.env.example` whenever a required setting is added.

PostgreSQL runs in Docker and is published on host port `5433` by default, avoiding conflicts with a local PostgreSQL service on `5432`. Set `POSTGRES_PORT` and update `DATABASE_URL` together if another port is required.

OpenAPI UI: `http://localhost:3000/docs`. Login returns a bearer JWT. Merchant calls require both the JWT and an `X-Tenant-ID`; the server verifies that the authenticated user has an active membership for that tenant. Never reuse the README JWT secret outside local development.

Run `npm run holds:expire` in a separate supervised process while using holds. It retries temporary database errors with bounded backoff and handles SIGINT/SIGTERM. Owner can query `GET /v1/merchant/booking/hold-expiry/backlog` to observe their tenant's overdue holds. This backlog is not a worker heartbeat; production supervision and alert thresholds require environment-specific setup.

Run `npm run outbox:work` as a separate supervised process when dispatching events. Owner can query `GET /v1/merchant/notifications/outbox/backlog` for tenant-scoped queue counts. Before applying migration `20261123050000_outbox_claim_token`, stop old outbox workers and restart them with the updated code; see `../docs/02-architecture/transactional-outbox.md`. No live notification provider is configured.

### Docker images and operations (OPS-005)

`Dockerfile` has two targets: `runtime` (default; API only, production dependencies) and `tools` (migrations and workers; includes `node-pg-migrate`, `ts-node`, `migrations/` and `scripts/`). With Compose:

```bash
docker compose --profile tools run --rm migrate     # apply migrations from inside Docker
docker compose --profile workers up -d              # hold-expiry and outbox workers
docker compose --profile workers stop               # stop the workers
```

Outside Compose: `docker build --target tools -t karaokenow-tools .` then run it with `DATABASE_URL` (default command `npm run db:migrate`) or with command `npm run holds:expire` / `npm run outbox:work` plus `DATABASE_URL` and `JWT_SECRET`. Set `SWAGGER_ENABLED=false` in production to disable `/docs`; block `/v1/metrics` at the reverse proxy.

Database pool and timeouts are bounded by default (OPS-004): `PG_POOL_MAX` 10, `PG_CONNECTION_TIMEOUT_MS` 5000, `PG_IDLE_TIMEOUT_MS` 30000, `PG_STATEMENT_TIMEOUT_MS` 15000, `PG_LOCK_TIMEOUT_MS` 5000, `PG_IDLE_IN_TRANSACTION_TIMEOUT_MS` 60000. Lock-wait timeouts return a retryable 409; statement or pool-wait timeouts return 503.

Access tokens last 15 minutes and are tied to a server-side session. Refresh tokens rotate on every use; reuse revokes the token family. Staff created with temporary passwords must call `POST /v1/auth/password/change` before accessing merchant APIs.

Run unit tests:

```bash
npm test
```

Run PostgreSQL migration and HTTP integration tests (requires a running Docker daemon):

```bash
npm run test:e2e
```

Never use the local credentials or synthetic test tenants in production.

