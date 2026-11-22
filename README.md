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
npm run start:dev
```

Backend API documentation is generated into `docs/02-architecture/openapi.json`. Run backend checks from `be/` with `npm run verify` and `npm run test:e2e`.

Frontend developers can read `docs/02-architecture/api-reference.md`. After API changes run `npm run openapi:generate` and `npm run api:docs` from `be/` to refresh both contracts.

## Frontend project

See `fe/README.md` for the frontend boundary and setup status. Frontend code must not be added to the NestJS backend package or access PostgreSQL directly.
