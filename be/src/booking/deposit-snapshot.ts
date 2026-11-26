import type { PoolClient } from 'pg';

export type DepositMode = 'NONE' | 'FIXED' | 'PERCENT';

export interface DepositPolicySnapshot {
  mode: DepositMode;
  fixedAmountVnd: string | null;
  percent: string | null;
  policyVersion: string | null;
  requiredAmountVnd: string;
}

/**
 * Required deposit for an exact quote total (UAT-PD-002, PD-004).
 * FIXED is capped at the total so a deposit never exceeds the booking price;
 * PERCENT is rounded up to the next whole VND so the collected deposit is never below the configured share.
 */
export function requiredDepositVnd(mode: DepositMode, fixedAmountVnd: string | null, percent: string | null, totalAmountVnd: string): string {
  const total = BigInt(totalAmountVnd);
  if (mode === 'NONE') return '0';
  if (mode === 'FIXED') {
    const fixed = BigInt(fixedAmountVnd!);
    return (fixed < total ? fixed : total).toString();
  }
  const [whole, fraction = ''] = percent!.split('.');
  const scaled = BigInt(whole + fraction.padEnd(4, '0').slice(0, 4)); // percent × 10^4
  const divisor = 1_000_000n; // 100 % × 10^4
  const numerator = total * scaled;
  return ((numerator + divisor - 1n) / divisor).toString();
}

/** Reads the current channel policy under its advisory lock and freezes it for the given total. Unconfigured means NONE (PD-004 default). */
export async function snapshotDepositPolicy(client: PoolClient, tenantId: string, channel: string, totalAmountVnd: string): Promise<DepositPolicySnapshot> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`deposit:${tenantId}:${channel}`]);
  const row = (await client.query(`SELECT mode,fixed_amount_vnd::text AS "fixedAmountVnd",percent::text AS percent,version::text AS version
    FROM tenant_deposit_policies WHERE tenant_id=$1 AND channel=$2`, [tenantId, channel])).rows[0];
  const mode: DepositMode = row?.mode ?? 'NONE';
  const fixedAmountVnd = row?.fixedAmountVnd ?? null, percent = row?.percent ?? null;
  return { mode, fixedAmountVnd, percent, policyVersion: row?.version ?? null, requiredAmountVnd: requiredDepositVnd(mode, fixedAmountVnd, percent, totalAmountVnd) };
}
