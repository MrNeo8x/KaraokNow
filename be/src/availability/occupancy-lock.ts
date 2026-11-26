import type { PoolClient } from 'pg';

/**
 * Serializes writes that create or widen a room's occupancy.
 *
 * The GiST exclusion constraint guarantees no overlap, but concurrent conflicting inserts each see the
 * other's uncommitted row and wait on each other, which PostgreSQL resolves as a deadlock only after
 * `deadlock_timeout`. Under 100 concurrent attempts this cascaded into ~90 s waits and HTTP 500s
 * (QA-002). Taking this transaction-scoped lock first makes later writers wait briefly, then see the
 * committed row and fail fast with 23P01 → 409. Call it inside the transaction, right before the write.
 */
export async function lockRoomOccupancy(client: Pick<PoolClient, 'query'>, roomId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`room-occupancy:${roomId}`]);
}
