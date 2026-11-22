# Room Occupancy Invariant

PostgreSQL is the correctness boundary for room scheduling. Maintenance blocks and future booking holds use the same `room_occupancy` table so they cannot race across separate calendars.

Intervals use timezone-aware `[start,end)` ranges. Therefore `10:00–12:00` and `12:00–13:00` are adjacent and allowed, while any positive intersection conflicts.

The `no_active_room_overlap` GiST exclusion constraint rejects overlapping rows for the same room when status is one of:

- `HELD`
- `CONFIRMED`
- `IN_USE`
- `MAINTENANCE`

`RELEASED` rows retain history but no longer reserve inventory. `source_type` distinguishes `BOOKING` and `MAINTENANCE`; `source_id` provides a unique link to the owning workflow.

Maintenance block creation/update and audit writes occur in one transaction. PostgreSQL exclusion error `23P01` maps to API conflict `409`. Release is idempotent and replaces physical deletion.

This schema does not decide hold TTL, booking duration, buffers or pricing. Those remain blocked product decisions.
