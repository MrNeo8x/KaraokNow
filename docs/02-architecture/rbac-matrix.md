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

`INACTIVE` is the current soft-delete state for branches and rooms. Physical deletion is not exposed because future bookings, attribution and audit records must retain referential history.

JWT proves the user identity. `X-Tenant-ID` selects the working tenant, but access is granted only when the authenticated user has an active membership for that tenant. Branch-scoped roles additionally require an explicit branch grant.

Password reset, email verification and external identity providers are not implemented. MFA is explicitly deferred until after the pilot (PD-018); password rate-limit and lockout controls remain in place.
