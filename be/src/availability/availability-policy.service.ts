import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { UpdateAvailabilityPolicyDto } from './availability-policy.dto';

export interface AvailabilityPolicy {
  bufferEnabled: boolean;
  bufferMinutes: number;
  version?: string;
}

@Injectable()
export class AvailabilityPolicyService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  async getPolicy(tenantId: string): Promise<AvailabilityPolicy> {
    const result = await this.db.query<AvailabilityPolicy>(
      `SELECT buffer_enabled AS "bufferEnabled",buffer_minutes AS "bufferMinutes",version::text
       FROM tenant_availability_policies WHERE tenant_id=$1`, [tenantId]);
    return result.rows[0] ?? { bufferEnabled: true, bufferMinutes: 15 };
  }

  async updatePolicy(actor: Actor, dto: UpdateAvailabilityPolicyDto): Promise<AvailabilityPolicy> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const tenantId = actor.tenantId!;
      const before = (await client.query<AvailabilityPolicy>(
        `SELECT buffer_enabled AS "bufferEnabled",buffer_minutes AS "bufferMinutes",version::text
         FROM tenant_availability_policies WHERE tenant_id=$1 FOR UPDATE`, [tenantId])).rows[0] ?? {
        bufferEnabled: true, bufferMinutes: 15, version: '0'
      };
      const result = await client.query<AvailabilityPolicy>(
        `INSERT INTO tenant_availability_policies(tenant_id,buffer_enabled,buffer_minutes,updated_by)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id) DO UPDATE SET buffer_enabled=EXCLUDED.buffer_enabled,
           buffer_minutes=EXCLUDED.buffer_minutes,updated_by=EXCLUDED.updated_by,updated_at=now(),
           version=tenant_availability_policies.version+1
         RETURNING buffer_enabled AS "bufferEnabled",buffer_minutes AS "bufferMinutes",version::text`,
        [tenantId, dto.bufferEnabled, dto.bufferMinutes, actor.userId]);
      await this.insertAudit(client, actor, tenantId, before, result.rows[0]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  private insertAudit(client: PoolClient, actor: Actor, tenantId: string, before: unknown, after: unknown) {
    return client.query(
      `INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
       VALUES ($1,$2,$3,'AVAILABILITY_POLICY_UPDATED','AVAILABILITY_POLICY',$4,$5,$6)`,
      [randomUUID(), tenantId, actor.userId, tenantId, JSON.stringify(before), JSON.stringify(after)]);
  }
}
