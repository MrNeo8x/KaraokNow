# Room Amenities and Media Metadata

Status: implemented baseline, 2026-11-22.

## Scope

Room amenities are free-form labels. The API does not impose an amenity catalog or merchant-specific vocabulary. Media rows contain an opaque `assetRef`, optional `altText`, and `displayOrder`; their CRUD API records metadata only and never uploads, downloads, fetches or signs media files.

`assetRef` uses a constrained identifier format and is not a URL. This keeps signed URL credentials and arbitrary query strings out of audit data while leaving the backing storage/provider undecided. A future upload workflow must be designed after the storage decision.

## API and authorization

- `GET/POST /v1/merchant/rooms/{roomId}/amenities`
- `PATCH/DELETE /v1/merchant/rooms/{roomId}/amenities/{amenityId}`
- `GET/POST /v1/merchant/rooms/{roomId}/media`
- `PATCH/DELETE /v1/merchant/rooms/{roomId}/media/{mediaId}`

Reads allow Owner, assigned Branch Manager, Receptionist and Cashier. Mutations allow Owner and assigned Branch Manager. Every child query filters by tenant and parent room; a child ID from another room returns not found. Successful mutations write audit records in the same transaction.

## Verification

PostgreSQL E2E coverage verifies CRUD, duplicate amenity rejection, input validation, parent-room scoping and audit actions. No file storage or media delivery behavior is claimed.
