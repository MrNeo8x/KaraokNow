import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { PolicyListQueryDto } from './policy-list.dto';

@Injectable()
export class HoldTtlService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}
  private validateChannel(channel: string) {
    if (!/^[A-Z][A-Z0-9_]{0,49}$/.test(channel)) throw new BadRequestException('Channel must use uppercase letters, digits and underscores');
  }
  async list(actor: Actor, query: PolicyListQueryDto) {
    const limit = query.limit ?? 50, offset = query.offset ?? 0;
    const rows = (await this.db.query(`SELECT channel,ttl_minutes AS "ttlMinutes",version::text FROM tenant_hold_ttl_policies WHERE tenant_id=$1 ORDER BY channel LIMIT $2 OFFSET $3`, [actor.tenantId, limit + 1, offset])).rows;
    return { items: rows.slice(0, limit), limit, offset, hasMore: rows.length > limit };
  }
  async get(actor: Actor, channel: string) {
    this.validateChannel(channel);
    const result = await this.db.query(`SELECT channel,ttl_minutes AS "ttlMinutes",version::text FROM tenant_hold_ttl_policies WHERE tenant_id=$1 AND channel=$2`, [actor.tenantId, channel]);
    return result.rows[0] ?? { channel, ttlMinutes: 15 };
  }
  async update(actor: Actor, channel: string, ttlMinutes: number) {
    this.validateChannel(channel);
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`hold-ttl:${actor.tenantId}:${channel}`]);
      const before = (await client.query(`SELECT channel,ttl_minutes AS "ttlMinutes",version::text FROM tenant_hold_ttl_policies WHERE tenant_id=$1 AND channel=$2 FOR UPDATE`, [actor.tenantId, channel])).rows[0] ?? { channel, ttlMinutes: 15 };
      const after = (await client.query(`INSERT INTO tenant_hold_ttl_policies(tenant_id,channel,ttl_minutes,updated_by) VALUES($1,$2,$3,$4)
        ON CONFLICT (tenant_id,channel) DO UPDATE SET ttl_minutes=EXCLUDED.ttl_minutes,updated_by=EXCLUDED.updated_by,updated_at=now(),version=tenant_hold_ttl_policies.version+1
        RETURNING channel,ttl_minutes AS "ttlMinutes",version::text`, [actor.tenantId, channel, ttlMinutes, actor.userId])).rows[0];
      await client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
        VALUES($1,$2,$3,'HOLD_TTL_POLICY_UPDATED','HOLD_TTL_POLICY',$2,$4,$5)`,
      [randomUUID(), actor.tenantId, actor.userId, JSON.stringify(before), JSON.stringify(after)]);
      await client.query('COMMIT');
      return after;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
