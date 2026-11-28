import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

/**
 * Serializes writes that create or widen a room's occupancy, and first releases that room's overdue holds.
 *
 * The GiST exclusion constraint guarantees no overlap, but concurrent conflicting inserts each see the
 * other's uncommitted row and wait on each other, which PostgreSQL resolves as a deadlock only after
 * `deadlock_timeout`. Under 100 concurrent attempts this cascaded into ~90 s waits and HTTP 500s
 * (QA-002). Taking this transaction-scoped lock first makes later writers wait briefly, then see the
 * committed row and fail fast with 23P01 → 409. Call it inside the transaction, right before the write.
 *
 * BKG-011: on Vercel Hobby the expiry cron runs once a day, so a hold past its TTL could keep its HELD occupancy
 * for up to ~24 h and block new holds for that slot. Every writer therefore expires this room's overdue holds here
 * (same effect and audit as the cron), skipping rows another transaction is already handling.
 */
export async function lockRoomOccupancy(client: Pick<PoolClient, 'query'>, roomId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`room-occupancy:${roomId}`]);
  await releaseOverdueHolds(client, roomId);
}

/** Expires HELD holds of the room whose TTL has passed and releases their occupancy (HOLD_EXPIRED audit). */
export async function releaseOverdueHolds(client: Pick<PoolClient, 'query'>, roomId: string): Promise<number> {
  const due = (await client.query<{ id: string }>(`SELECT id FROM booking_holds WHERE room_id=$1 AND status='HELD' AND expires_at<=clock_timestamp()
    ORDER BY expires_at FOR UPDATE SKIP LOCKED`, [roomId])).rows;
  for (const hold of due) await expireOverdueHold(client, hold.id);
  return due.length;
}

/** Marks an overdue HELD hold EXPIRED and releases its occupancy; no-op otherwise. Caller holds the row lock. */
export async function expireOverdueHold(client: Pick<PoolClient, 'query'>, holdId: string): Promise<boolean> {
  const expired = (await client.query<{ tenant_id: string; occupancy_id: string }>(`UPDATE booking_holds SET status='EXPIRED',updated_at=clock_timestamp()
    WHERE id=$1 AND status='HELD' AND expires_at<=clock_timestamp() RETURNING tenant_id,occupancy_id`, [holdId])).rows[0];
  if (!expired) return false;
  await client.query(`UPDATE room_occupancy SET status='RELEASED',updated_at=clock_timestamp() WHERE id=$1 AND status='HELD'`, [expired.occupancy_id]);
  await client.query(`INSERT INTO audit_logs(id,tenant_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'HOLD_EXPIRED','BOOKING_HOLD',$3,$4)`,
    [randomUUID(), expired.tenant_id, holdId, JSON.stringify({ status: 'EXPIRED' })]);
  return true;
}
