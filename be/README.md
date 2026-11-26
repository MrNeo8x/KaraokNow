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

