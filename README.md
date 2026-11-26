# KaraokeNow

KaraokeNow is organized as separate frontend and backend projects:

- `fe/` — Next.js frontend (customer `/booking`, merchant workspace `/merchant`, Platform Admin `/platform`), built and released separately; it consumes the backend HTTPS API/OpenAPI contract.
- `be/` — NestJS/TypeScript backend, migrations, tests, scripts, local Compose setup and backend package manifests.
- `docs/` — shared product, requirements, architecture and delivery documentation.

The backend implements identity/tenant foundations, branch and room management, maintenance blocks, pricing, availability, staff and public holds, deposits on holds, confirmation, check-in/out, staff-reviewed cancellation/no-show, manual CASH payments, public catalog and Platform Admin listing approval/merchant onboarding. Online payment and live channel integrations are out of pilot scope. Consult the task board before treating a capability as released.

**Agents (Codex/Claude Code):** start with [`AGENTS.md`](AGENTS.md) and [`docs/03-delivery/work-log.md`](docs/03-delivery/work-log.md).

## Backend local development

```bash
cd be
docker compose up -d postgres
npm ci
cp .env.example .env
npm run db:migrate
npm run db:seed:uat
npm run start:dev
```

In another terminal, start the browser UAT frontend:

```bash
cd fe
npm ci
npm run dev
```

Open `http://localhost:3100/merchant`. Local UAT credentials are printed by `npm run db:seed:uat`; the stable tenant ID is `10000000-0000-4000-8000-000000000001`.

UAT scenarios and accounts: `docs/04-quality/uat-checklist.md`. Booking benchmark: `npm run bench:booking` in `be/` (see `docs/04-quality/booking-benchmark.md`).

Backend API documentation is generated into `docs/02-architecture/openapi.json`. Run backend checks from `be/` with `npm run verify` and `npm run test:e2e`.

## Browser UAT with Docker Desktop

The persistent local UAT stack runs PostgreSQL, backend and frontend in Docker Desktop:

```bash
cd be
docker compose up -d postgres
npm run db:migrate          # the backend container does not migrate by itself
npm run db:seed:uat         # merchants UAT (all roles) and UAT2 (awaiting approval) + Platform Admin
docker compose up -d --build
```

The hold-expiry and outbox workers are not part of Compose; run `npm run holds:expire` / `npm run outbox:work` from `be/` when testing expiry or notifications.

Open `http://localhost:3100/merchant` (merchant) or `http://localhost:3100/platform` (Platform Admin). Backend health is available at `http://localhost:3000/v1/health/ready` and Swagger at `http://localhost:3000/docs`.

Frontend developers can read `docs/02-architecture/api-reference.md`. After API changes run `npm run openapi:generate` and `npm run api:docs` from `be/` to refresh both contracts.

## Frontend project

See `fe/README.md` for the frontend boundary and setup status. Frontend code must not be added to the NestJS backend package or access PostgreSQL directly.
