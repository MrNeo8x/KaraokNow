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

Platform listing approval is outside the merchant matrix. `GET /v1/platform/catalog/listings` and approve/revoke require a global, non-revoked `platform_admins` grant (no `X-Tenant-ID`), provisioned only through data. A Platform Admin who has an active membership in the target tenant is rejected, so merchant users cannot approve their own listing. The same global grant allows `GET/POST /v1/platform/merchants` to list merchants and onboard a merchant with its first Owner (PD-029), and `POST /v1/platform/merchants/{tenantId}/suspend|reactivate` (PD-031; rejected when the admin belongs to that merchant). A suspended merchant's staff keep their merchant permissions for existing holds/bookings but cannot create new holds.

`INACTIVE` is the current soft-delete state for branches and rooms. Physical deletion is not exposed because future bookings, attribution and audit records must retain referential history.

JWT proves the user identity. `X-Tenant-ID` selects the working tenant, but access is granted only when the authenticated user has an active membership for that tenant. Branch-scoped roles additionally require an explicit branch grant.

Password reset, email verification and external identity providers are not implemented. MFA is explicitly deferred until after the pilot (PD-018); password rate-limit and lockout controls remain in place.

Cashier read access to holds and bookings (API-003, 2026-11-26) was added so cashiers can reach the hold/booking they record deposits and CASH against; it grants no create, confirm, check-in/out or outcome rights. Cashiers seeing customer phone and email was confirmed by PO on 2026-11-28 (PD-032).
