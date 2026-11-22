import { BadRequestException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { UpdateDepositPolicyDto } from './deposit-policy.dto';
import { PolicyListQueryDto } from './policy-list.dto';

const columns = `channel,mode,fixed_amount_vnd::text AS "fixedAmountVnd",percent::text AS percent,version::text`;
@Injectable()
export class DepositPolicyService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}
  private validateChannel(channel: string) {
    if (!/^[A-Z][A-Z0-9_]{0,49}$/.test(channel)) throw new BadRequestException('Channel must use uppercase letters, digits and underscores');
  }
  private validate(dto: UpdateDepositPolicyDto) {
    const fixed = dto.fixedAmountVnd ?? null, percent = dto.percent ?? null;
    if (dto.mode === 'NONE' && (fixed !== null || percent !== null)) throw new UnprocessableEntityException('NONE must not include an amount or percent');
    if (dto.mode === 'FIXED' && (fixed === null || percent !== null || BigInt(fixed) > 9223372036854775807n)) throw new UnprocessableEntityException('FIXED requires a valid fixed amount only');
    if (dto.mode === 'PERCENT' && (percent === null || fixed !== null || Number(percent) <= 0 || Number(percent) > 100)) throw new UnprocessableEntityException('PERCENT requires a percentage greater than zero and at most 100');
  }
  async list(actor: Actor, query: PolicyListQueryDto) {
    const limit = query.limit ?? 50, offset = query.offset ?? 0;
    const rows = (await this.db.query(`SELECT ${columns} FROM tenant_deposit_policies WHERE tenant_id=$1 ORDER BY channel LIMIT $2 OFFSET $3`, [actor.tenantId, limit + 1, offset])).rows;
    return { items: rows.slice(0, limit).map(row => ({ ...row, configured: true })), limit, offset, hasMore: rows.length > limit };
  }
  async get(actor: Actor, channel: string) {
    this.validateChannel(channel);
    const row = (await this.db.query(`SELECT ${columns} FROM tenant_deposit_policies WHERE tenant_id=$1 AND channel=$2`, [actor.tenantId, channel])).rows[0];
    return row ? { ...row, configured: true } : { channel, configured: false, mode: 'NONE', fixedAmountVnd: null, percent: null };
  }
  async update(actor: Actor, channel: string, dto: UpdateDepositPolicyDto) {
    this.validateChannel(channel); this.validate(dto);
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`deposit:${actor.tenantId}:${channel}`]);
      const previous = (await client.query(`SELECT ${columns} FROM tenant_deposit_policies WHERE tenant_id=$1 AND channel=$2 FOR UPDATE`, [actor.tenantId, channel])).rows[0];
      const before = previous ? { ...previous, configured: true } : { channel, configured: false, mode: 'NONE', fixedAmountVnd: null, percent: null };
      const row = (await client.query(`INSERT INTO tenant_deposit_policies(tenant_id,channel,mode,fixed_amount_vnd,percent,updated_by) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT (tenant_id,channel) DO UPDATE SET mode=EXCLUDED.mode,fixed_amount_vnd=EXCLUDED.fixed_amount_vnd,percent=EXCLUDED.percent,
        updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp(),version=tenant_deposit_policies.version+1 RETURNING ${columns}`,
      [actor.tenantId, channel, dto.mode, dto.fixedAmountVnd ?? null, dto.percent ?? null, actor.userId])).rows[0];
      const after = { ...row, configured: true };
      await client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
        VALUES($1,$2,$3,'DEPOSIT_POLICY_UPDATED','DEPOSIT_POLICY',$2,$4,$5)`,
      [randomUUID(), actor.tenantId, actor.userId, JSON.stringify(before), JSON.stringify(after)]);
      await client.query('COMMIT'); return after;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
