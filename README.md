# KaraokeNow

KaraokeNow is at foundation stage. The only implemented slice is tenant-scoped branch and room management; booking, pricing, payment, channels and frontend are not implemented.

## Run locally

Requirements: Node.js 24+, npm and Docker.

```bash
docker compose up -d postgres
npm install
cp .env.example .env
# Replace JWT_SECRET in .env with a private value of at least 32 characters.
npm run db:migrate
npm run start:dev
```

The application loads `.env` automatically and validates `DATABASE_URL`, `JWT_SECRET` and `PORT` at startup. Real `.env` files are ignored by Git; update `.env.example` whenever a required setting is added.

PostgreSQL runs in Docker and is published on host port `5433` by default, avoiding conflicts with a local PostgreSQL service on `5432`. Set `POSTGRES_PORT` and update `DATABASE_URL` together if another port is required.

OpenAPI UI: `http://localhost:3000/docs`. Login returns a bearer JWT. Merchant calls require both the JWT and an `X-Tenant-ID`; the server verifies that the authenticated user has an active membership for that tenant. Never reuse the README JWT secret outside local development.

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

