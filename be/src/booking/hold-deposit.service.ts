import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import type { DepositPolicySnapshot } from './deposit-snapshot';
import { RecordHoldDepositDto } from './hold-deposit.dto';

const fields = `id,hold_id AS "holdId",branch_id AS "branchId",method,amount_vnd::text AS "amountVnd",note,recorded_by AS "recordedBy",recorded_at AS "recordedAt",
  EXISTS(SELECT 1 FROM money_reversals r WHERE r.entry_type='HOLD_DEPOSIT' AND r.entry_id=hold_deposits.id) AS reversed`;
/** Net deposits on a hold: reversed entries (PAY-007) no longer count toward coverage or limits. */
export const NET_HOLD_DEPOSITS_SQL = `SELECT COALESCE(SUM(d.amount_vnd),0)::text AS total FROM hold_deposits d WHERE d.tenant_id=$1 AND d.hold_id=$2
  AND NOT EXISTS (SELECT 1 FROM money_reversals r WHERE r.entry_type='HOLD_DEPOSIT' AND r.entry_id=d.id)`;

@Injectable()
export class HoldDepositService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  async status(actor: Actor, holdId: string) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const hold = await this.lockHold(client, actor, holdId);
      const result = await this.statusOf(client, actor.tenantId!, holdId, hold);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async record(actor: Actor, holdId: string, key: string, dto: RecordHoldDepositDto) {
    if (!key || !/^[\x21-\x7e]{1,100}$/.test(key)) throw new BadRequestException('Idempotency-Key must contain 1–100 visible ASCII characters');
    const hash = createHash('sha256').update(JSON.stringify([holdId, dto.method, dto.amountVnd, dto.note ?? null])).digest('hex');
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`hold-deposit:${actor.tenantId}:${actor.userId}:${key}`]);
      const hold = await this.lockHold(client, actor, holdId);
      const prior = (await client.query(`SELECT ${fields},request_hash FROM hold_deposits WHERE tenant_id=$1 AND recorded_by=$2 AND idempotency_key=$3`,
        [actor.tenantId, actor.userId, key])).rows[0];
      if (prior) {
        if (prior.request_hash !== hash) throw new ConflictException('Idempotency key was used for a different deposit');
        delete prior.request_hash; await client.query('COMMIT'); return prior;
      }
      if (hold.status !== 'HELD' || !hold.valid) throw new ConflictException('Deposits can only be recorded on an active hold');
      const snapshot = hold.deposit_policy_snapshot as DepositPolicySnapshot | null;
      if (!snapshot) throw new ConflictException('Customer details and price snapshot must be recorded before a deposit');
      if (snapshot.mode === 'NONE' || BigInt(snapshot.requiredAmountVnd) === 0n) throw new ConflictException('This hold does not require a deposit');
      const recorded = BigInt(await this.recordedTotal(client, actor.tenantId!, holdId));
      const remaining = BigInt(snapshot.requiredAmountVnd) - recorded;
      if (BigInt(dto.amountVnd) > remaining) throw new ConflictException(`Deposit exceeds the remaining required amount (${remaining > 0n ? remaining : 0n} VND)`);
      const id = randomUUID();
      const row = (await client.query(`INSERT INTO hold_deposits(id,tenant_id,branch_id,hold_id,method,amount_vnd,note,recorded_by,idempotency_key,request_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${fields}`,
      [id, actor.tenantId, hold.branch_id, holdId, dto.method, dto.amountVnd, dto.note ?? null, actor.userId, key, hash])).rows[0];
      await client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
        VALUES($1,$2,$3,'HOLD_DEPOSIT_RECORDED','HOLD_DEPOSIT',$4,$5)`,
      [randomUUID(), actor.tenantId, actor.userId, id, JSON.stringify({ holdId, method: dto.method, amountVnd: dto.amountVnd, requiredAmountVnd: snapshot.requiredAmountVnd })]);
      await client.query('COMMIT'); return row;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  /** Net of reversals. Caller must hold the hold row lock so concurrent deposits/confirmation/reversals see a stable total. */
  async recordedTotal(client: PoolClient, tenantId: string, holdId: string): Promise<string> {
    return (await client.query(NET_HOLD_DEPOSITS_SQL, [tenantId, holdId])).rows[0].total;
  }

  private async lockHold(client: PoolClient, actor: Actor, holdId: string) {
    const hold = (await client.query(`SELECT id,branch_id,status,deposit_policy_snapshot,expires_at>clock_timestamp() AS valid
      FROM booking_holds WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [actor.tenantId, holdId])).rows[0];
    if (!hold) throw new NotFoundException('Hold not found');
    if (!actor.roles.includes('OWNER') && !actor.branchIds.includes(hold.branch_id)) throw new ForbiddenException('Branch access denied');
    return hold;
  }

  private async statusOf(client: PoolClient, tenantId: string, holdId: string, hold: { status: string; valid: boolean; deposit_policy_snapshot: DepositPolicySnapshot | null }) {
    const items = (await client.query(`SELECT ${fields} FROM hold_deposits WHERE tenant_id=$1 AND hold_id=$2 ORDER BY recorded_at,id`, [tenantId, holdId])).rows;
    const recorded = items.filter(item => !item.reversed).reduce((sum, item) => sum + BigInt(item.amountVnd), 0n);
    const snapshot = hold.deposit_policy_snapshot;
    const required = BigInt(snapshot?.requiredAmountVnd ?? '0');
    const remaining = required > recorded ? required - recorded : 0n;
    return {
      holdId, holdStatus: hold.status === 'HELD' && !hold.valid ? 'EXPIRED' : hold.status, depositPolicySnapshot: snapshot,
      requiredAmountVnd: required.toString(), totalRecordedVnd: recorded.toString(), remainingVnd: remaining.toString(),
      depositSatisfied: !!snapshot && snapshot.mode !== 'NONE' && recorded >= required, items
    };
  }
}
