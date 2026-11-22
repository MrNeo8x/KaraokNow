import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { PolicyListQueryDto } from './policy-list.dto';

@Injectable()
export class NoDepositPolicyService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}
  private validateChannel(channel: string) {
    if (!/^[A-Z][A-Z0-9_]{0,49}$/.test(channel)) throw new BadRequestException('Channel must use uppercase letters, digits and underscores');
  }
  async list(actor: Actor, query: PolicyListQueryDto) {
    const limit = query.limit ?? 50, offset = query.offset ?? 0;
    const rows = (await this.db.query(`SELECT channel,allowed,version::text FROM tenant_no_deposit_confirmation_policies WHERE tenant_id=$1 ORDER BY channel LIMIT $2 OFFSET $3`, [actor.tenantId, limit + 1, offset])).rows;
    return { items: rows.slice(0, limit).map(row => ({ ...row, configured: true })), limit, offset, hasMore: rows.length > limit };
  }
  async get(actor: Actor, channel: string) {
    this.validateChannel(channel);
    const row = (await this.db.query(`SELECT channel,allowed,version::text FROM tenant_no_deposit_confirmation_policies WHERE tenant_id=$1 AND channel=$2`, [actor.tenantId, channel])).rows[0];
    return row ? { ...row, configured: true } : { channel, configured: false, allowed: null };
  }
  async update(actor: Actor, channel: string, allowed: boolean) {
    this.validateChannel(channel);
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`no-deposit:${actor.tenantId}:${channel}`]);
      const prior = (await client.query(`SELECT channel,allowed,version::text FROM tenant_no_deposit_confirmation_policies WHERE tenant_id=$1 AND channel=$2 FOR UPDATE`, [actor.tenantId, channel])).rows[0];
      const before = prior ? { ...prior, configured: true } : { channel, configured: false, allowed: null };
      const row = (await client.query(`INSERT INTO tenant_no_deposit_confirmation_policies(tenant_id,channel,allowed,updated_by) VALUES($1,$2,$3,$4)
        ON CONFLICT (tenant_id,channel) DO UPDATE SET allowed=EXCLUDED.allowed,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp(),version=tenant_no_deposit_confirmation_policies.version+1
        RETURNING channel,allowed,version::text`, [actor.tenantId, channel, allowed, actor.userId])).rows[0];
      const after = { ...row, configured: true };
      await client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
        VALUES($1,$2,$3,'NO_DEPOSIT_CONFIRMATION_POLICY_UPDATED','NO_DEPOSIT_CONFIRMATION_POLICY',$2,$4,$5)`,
      [randomUUID(), actor.tenantId, actor.userId, JSON.stringify(before), JSON.stringify(after)]);
      await client.query('COMMIT'); return after;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
