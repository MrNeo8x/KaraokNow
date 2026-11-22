# KaraokeNow Frontend

Next.js (React) + TypeScript frontend, built independently from the NestJS backend. Tailwind CSS and shadcn/ui configuration are available; existing screens retain their original CSS while components are migrated incrementally.

## Chạy local

```bash
cd fe
npm ci
npm run dev
```

Next.js runs on port 3001 and rewrites `/v1` to `http://localhost:3000` by default. Set server-side `BACKEND_API_ORIGIN` for another backend origin. Use Node 24 or newer, and run `npm run build` to build. Webpack is used for builds because this environment blocks Turbopack's internal port.

Run `npm test` for API-client contract unit tests. `.github/workflows/frontend-ci.yml` runs install, tests and build independently of backend CI; browser and live FE–BE tests are not yet configured.

## Sprint hiện tại

- Merchant: login, forced password change, logout, tenant ID selection, branch/room reads and creation, branch name/timezone and room name/capacity edits, and room status changes use the backend API. Session stays in memory; reload requires login. Automatic refresh and tenant discovery remain backlog. Backend enforces role and branch permissions.
- Room amenities can be listed, added, edited and deleted through the existing backend API. Browser integration and role-based UAT are still pending.
- Merchant users can query room availability and request a quote for the selected interval. Search does not create a hold.
- Staff can explicitly create a `WALK_IN` hold, retry the same attempt using its idempotency key and check its returned status, or look up a known hold UUID after reload. This does not confirm a booking or save a customer/quote. An uncertain attempt's retry key is memory-only and is lost on reload/navigation; full recovery and browser/backend integration tests remain pending.
- Staff can list holds for the selected branch and an explicit time interval with pagination. This list is not a confirmed-booking calendar; expired status does not itself release occupancy.
- API errors use the backend error envelope, display safe validation details and correlation ID, and suppress server-side details for 5xx responses. Contract: `../docs/02-architecture/api-reference.md` and `../docs/02-architecture/api-error-contract.md`.
- Duration and cleanup buffer policies, price plan list/create/update and price rule list/create/edit use existing APIs. Advanced selectors accept room and special-date UUIDs; a selection UI and live browser/role verification remain pending.
- Routes: `/` is the landing page, `/merchant` is the Merchant portal, and `/booking` is the customer experience.
- Customer: mobile-first location, date, time and room selection uses explicitly labeled demonstration data. It cannot create a booking; public booking/hold APIs remain dependencies.
- Delivery sequence and backend dependencies are in `../docs/02-architecture/frontend-implementation-plan.md`.

## Architecture contract

- Build frontend as a separate application and release artifact from `be/`.
- Merchant admin/reception and customer booking UI may be separate applications or separately routed frontend apps; neither belongs inside the NestJS backend.
- Frontend communicates with backend through versioned HTTPS APIs described by the shared OpenAPI contract in `../docs/02-architecture/openapi.json`.
- Never connect frontend code directly to PostgreSQL or embed backend/provider secrets in browser bundles.
- Customer booking UI must work in a normal mobile browser and may also be hosted in Zalo/Messenger WebView. Chat integrations are conditional on platform approval.
- Source organization (separate repository versus monorepo/workspace) is not yet decided; this directory is the current project boundary.

Customer demonstration data is not a live booking service. Merchant session is in memory and is cleared when navigating away or reloading.
