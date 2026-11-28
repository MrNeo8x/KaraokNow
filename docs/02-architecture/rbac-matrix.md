# Merchant RBAC Matrix

This is the conservative authorization baseline implemented for the current venue module. Changes require PO/security review and corresponding tests.

| Capability | Owner | Branch Manager | Receptionist | Cashier |
|---|---:|---:|---:|---:|
| List/read permitted branches and rooms | Yes, all tenant branches | Assigned only | Assigned only | Assigned only |
| Create branch | Yes | No | No | No |
| Update branch or status | Yes | Assigned only | No | No |
| Create/update room or status | Yes | Assigned only | No | No |
| Manage memberships, roles and branch grants | Yes | No | No | No |
| Read tenant audit log | Yes | No | No | No |
| Read booking calendar, booking detail, hold list and hold detail in assigned branch | Yes, all tenant branches | Assigned only | Assigned only | Assigned only (read-only, since 2026-11-26 API-003) |
| Read/record manual CASH payment for confirmed booking | Yes, all tenant branches | Assigned only | No | Assigned only |
| Publish merchant catalog (does not approve listing for marketplace) | Yes | No | No | No |
| Read hold deposit status in assigned branch | Yes, all tenant branches | Assigned only | Assigned only | Assigned only |
| Record CASH deposit on an active hold | Yes, all tenant branches | Assigned only | No | Assigned only |
| Check in / check out a booking | Yes, all tenant branches | Assigned only | Assigned only | No |
| Read overtime grace policy | Yes | Yes | Yes | Yes |
| Read own identity, roles and branch grants (`GET /v1/merchant/me`) | Yes | Yes | Yes | Yes |
| Update overtime grace policy | Yes | Yes | No | No |
| Record cancellation / no-show outcome and CASH refund | Yes, all tenant branches | Assigned only | No | No |
| Read booking account (due vs paid, ledger entries) | Yes, all tenant branches | Assigned only | Assigned only | Assigned only |
| Add a booking surcharge | Yes, all tenant branches | Assigned only | Assigned only | Assigned only |
| Reverse a deposit, CASH payment or surcharge | Yes, all tenant branches | Assigned only | No | No |
| List unresolved expired-hold deposits; read daily cash report | Yes, all tenant branches | Assigned only | No | Assigned only |
| Resolve an expired-hold deposit (refund/keep) | Yes, all tenant branches | Assigned only | No | No |
| View/download reports (`/v1/merchant/reports/bookings|occupancy|channels`, JSON or CSV) | Yes, all tenant branches | Assigned only | No | No |
| Set branch address, phone and Google Maps location; preview a Maps link (`POST /v1/merchant/branch-location/resolve`) | Yes, all tenant branches | Assigned only | No | No |
| Upload/edit/delete merchant gallery photos (`/v1/merchant/catalog/photos`, ≤ 10) | Yes | No | No | No |
| Upload/edit/delete branch gallery photos (`/v1/merchant/branches/{id}/photos`, ≤ 10) | Yes, all tenant branches | Assigned only | No | No |
| View merchant/branch galleries | Yes | Yes (assigned branches) | Yes (assigned branches) | Yes (assigned branches) |
| Upload/delete room photos (public store) | Yes, all tenant branches | Assigned only | No | No |
| Read the merchant logo | Yes | Yes | Yes | Yes |
| Upload/remove the merchant logo | Yes | No | No | No |
| Upload/list/download/delete merchant PDF documents (private store) | Yes | No | No | No |

Platform listing approval is outside the merchant matrix. `GET /v1/platform/catalog/listings` and approve/revoke require a global, non-revoked `platform_admins` grant (no `X-Tenant-ID`), provisioned through data or by another Platform Admin (PD-040). A Platform Admin who has an active membership in the target tenant is rejected, so merchant users cannot approve their own listing. The same global grant allows `GET/POST /v1/platform/merchants` to list merchants and onboard a merchant with its first Owner (PD-029), and `POST /v1/platform/merchants/{tenantId}/suspend|reactivate` (PD-031; rejected when the admin belongs to that merchant). A suspended merchant's staff keep their merchant permissions for existing holds/bookings but cannot create new holds.

`INACTIVE` is the current soft-delete state for branches and rooms. Physical deletion is not exposed because future bookings, attribution and audit records must retain referential history.

JWT proves the user identity. `X-Tenant-ID` selects the working tenant, but access is granted only when the authenticated user has an active membership for that tenant. Branch-scoped roles additionally require an explicit branch grant.

Password reset, email verification and external identity providers are not implemented. MFA is explicitly deferred until after the pilot (PD-018); password rate-limit and lockout controls remain in place.

Cashier read access to holds and bookings (API-003, 2026-11-26) was added so cashiers can reach the hold/booking they record deposits and CASH against; it grants no create, confirm, check-in/out or outcome rights. Cashiers seeing customer phone and email was confirmed by PO on 2026-11-28 (PD-032).

Platform user management (PD-040), all under `AuthGuard` → `PlatformAdminGuard`, no `X-Tenant-ID`: `GET /v1/platform/users[/{id}]`; `POST /v1/platform/users/{id}/disable|enable|temporary-password|platform-admin|platform-admin/revoke` (reason required; never on the caller's own account; at least one active Platform Admin remains); `GET /v1/platform/merchants/{tenantId}/memberships|branches`, `POST …/memberships`, `PATCH …/memberships/{membershipId}` (reason required; rejected when the admin belongs to that merchant; at least one active Owner remains).

Any signed-in user may list their own active merchant memberships (`GET /v1/me/tenants`: tenant name, status and their roles; no X-Tenant-ID, no other members' data) — PD-039.

Platform Admins may list and download any merchant's PDF documents (`/v1/platform/merchants/{tenantId}/documents`) for listing review (PD-037).

Platform reports (`GET /v1/platform/reports/overview|merchants`, JSON or CSV) require the Platform Admin grant; they return counts and money totals per merchant, no customer data (PD-044).

### Data-level scope of reports and aggregates (reviewed 2026-11-28, RPT-002)

- Every merchant query filters on the caller's `X-Tenant-ID` (membership checked by `TenantGuard`) and, for branch-scoped roles, on `actor.branchIds`; Owner sees all branches of the tenant.
- Merchant reports (`/v1/merchant/reports/*`): Owner and Branch Manager only. Branch Manager without `branchId` gets assigned branches only; an unassigned branch → 403; a branch of another tenant → 404 (also for Owner). Receptionist/Cashier → 403.
- Daily cash report, unresolved deposits, branch hold/booking lists (reception calendar), booking account and manual payments: branch checked against `actor.branchIds` for non-Owners.
- Owner-only tenant-wide aggregates: audit log, hold-expiry backlog, outbox backlog.
- Platform reports and user management: Platform Admin grant only; counts and money totals per merchant, no customer contact data.
- Public: `/v1/health/jobs` (platform-wide counts only, PD-041) and `/v1/metrics` (request counts by method/status, no data).

### Super Admin support sessions and dual roles (PD-045, PD-046)

- `POST /v1/platform/support-sessions` `{tenantId, reason}`, `GET …?status=active|all`, `POST …/{id}/end`, `POST /v1/platform/users/{id}/super-admin[/revoke]`: Super Admin only (`platform_admins.super_admin`).
- With an active session, `TenantGuard` accepts the Super Admin for that tenant as `OWNER` with `actor.support` set: only GET/HEAD pass (others → 403 "Support sessions are read-only"); `SupportMaskInterceptor` masks `customerPhone`, `customerEmail`, `email` in every response. Not usable for a merchant the admin belongs to (they use their own membership).
- A Platform Admin may hold memberships; a real membership always takes precedence over a support session. Platform actions on a merchant they belong to stay forbidden (listing approval, suspend/reactivate, Platform membership edits, support session).
