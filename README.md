# KaraokeNow

KaraokeNow is organized as separate frontend and backend projects:

- `fe/` — frontend applications live here. They are built and released separately and consume the backend HTTPS API/OpenAPI contract. No frontend framework has been scaffolded yet.
- `be/` — NestJS/TypeScript backend, migrations, tests, scripts, local Compose setup and backend package manifests.
- `docs/` — shared product, requirements, architecture and delivery documentation.

The backend currently implements identity/tenant foundations, branch and room management, maintenance blocks, pricing, availability foundations and operational infrastructure. Booking lifecycle and user-facing frontends are still under development; consult the task board before treating a capability as released.

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

Backend API documentation is generated into `docs/02-architecture/openapi.json`. Run backend checks from `be/` with `npm run verify` and `npm run test:e2e`.

## Browser UAT with Docker Desktop

The persistent local UAT stack runs PostgreSQL, backend and frontend in Docker Desktop:

```bash
cd be
docker compose up -d --build
npm run db:migrate
npm run db:seed:uat
```

Open `http://localhost:3100/merchant`. Backend health is available at `http://localhost:3000/v1/health/ready` and Swagger at `http://localhost:3000/docs`.

Frontend developers can read `docs/02-architecture/api-reference.md`. After API changes run `npm run openapi:generate` and `npm run api:docs` from `be/` to refresh both contracts.

## Frontend project

See `fe/README.md` for the frontend boundary and setup status. Frontend code must not be added to the NestJS backend package or access PostgreSQL directly.
