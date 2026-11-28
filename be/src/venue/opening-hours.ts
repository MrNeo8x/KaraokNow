import { UnprocessableEntityException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

/** PD-043: customer start times use 15-minute steps (staff holds are not restricted). */
export const PUBLIC_START_STEP_MINUTES = 15;

/**
 * Checks a customer-chosen start time against the branch: on a 15-minute boundary in the branch timezone, and the whole
 * booking [start, start + duration) inside one opening window. A window opens at `opens_at` on a local date and closes at
 * `closes_at` the same day, or the next day when `closes_at <= opens_at` (after midnight). No opening hours = no limit.
 * Invalid timestamps are left to the caller's own validation.
 */
export async function assertPublicStartAllowed(db: Pick<Pool | PoolClient, 'query'>, branchId: string, startAt: string, durationMinutes: number) {
  if (!Number.isFinite(new Date(startAt).getTime()) || !/[Tt].*(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(startAt) || !Number.isInteger(durationMinutes)) return;
  const row = (await db.query<{ aligned: boolean; within: boolean; opens: string | null; closes: string | null }>(`SELECT
      (extract(second FROM x.ls)=0 AND extract(minute FROM x.ls)::int % $4 = 0) AS aligned,
      (b.opens_at IS NULL OR EXISTS (SELECT 1 FROM (VALUES (x.ls::date),(x.ls::date - 1)) d(day)
        WHERE x.ls >= d.day + b.opens_at
          AND x.ls + make_interval(mins => $3::int) <= d.day + b.closes_at + CASE WHEN b.closes_at <= b.opens_at THEN interval '1 day' ELSE interval '0' END)) AS within,
      to_char(b.opens_at,'HH24:MI') AS opens,to_char(b.closes_at,'HH24:MI') AS closes
    FROM branches b CROSS JOIN LATERAL (SELECT ($2::timestamptz AT TIME ZONE b.timezone) AS ls) x WHERE b.id=$1`,
  [branchId, startAt, durationMinutes, PUBLIC_START_STEP_MINUTES])).rows[0];
  if (!row) return;
  if (!row.aligned) throw new UnprocessableEntityException(`startAt must be on a ${PUBLIC_START_STEP_MINUTES}-minute boundary`);
  if (!row.within) throw new UnprocessableEntityException(`The booking must start and end within the branch opening hours (${row.opens}–${row.closes})`);
}
