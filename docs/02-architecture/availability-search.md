# Availability search

`GET /v1/merchant/branches/{branchId}/availability?startAt=...&durationMinutes=...` returns active rooms in an active tenant branch that can accommodate the requested interval.

The endpoint validates the tenant's configured duration minimum, maximum and increment. It evaluates active `room_occupancy` entries (held, confirmed, in-use and maintenance) using half-open `[start,end)` overlap semantics and omits inactive rooms and branches.

Under PD-024, a candidate reservation starts at the requested start and ends at `start + duration + buffer`. The buffer is applied after the booking only; when disabled, the applied buffer is zero. Default settings are enabled with 15 minutes, and Owner/Branch Manager can edit them through the audited buffer-policy API.

The API is tenant and branch scoped and is available to Owner, Branch Manager, Receptionist and Cashier. It is a read/search API, not a hold: concurrent callers may see the same room. The future booking/hold transaction must store booking occupancy through its cleanup buffer end so later searches observe that reservation boundary.
