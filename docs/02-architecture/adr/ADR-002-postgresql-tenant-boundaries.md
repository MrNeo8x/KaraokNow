# ADR-002: PostgreSQL and Tenant Boundaries

- Status: Proposed baseline, partially implemented
- Date: 2026-11-22

## Decision

PostgreSQL is the authoritative transactional store. Tenant-owned tables carry `tenant_id`. Composite foreign keys prevent a child record from referencing a parent in another tenant. Application queries must scope by tenant even when looking up globally unique UUIDs.

The current `X-Tenant-ID` header is only a development-stage context carrier. It does not prove identity or authorization. Before merchant UAT, authentication must bind an authenticated user to allowed tenant and branch memberships, and APIs must reject caller-supplied tenant impersonation.

## Verification

- Migration establishes composite branch/tenant referential integrity.
- Unit tests assert tenant predicates are sent to PostgreSQL.
- Integration tests must prove tenant B cannot read or attach a room to tenant A's branch.

