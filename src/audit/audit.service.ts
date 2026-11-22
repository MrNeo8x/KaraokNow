import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../platform/database/database.module';

export interface AuditLog {
  id: string; actorUserId: string | null; action: string; entityType: string;
  entityId: string; beforeData: unknown; afterData: unknown; occurredAt: string;
}

@Injectable()
export class AuditService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}
  async list(tenantId: string, limit: number, offset: number): Promise<AuditLog[]> {
    return (await this.db.query<AuditLog>(
      `SELECT id,actor_user_id AS "actorUserId",action,entity_type AS "entityType",entity_id AS "entityId",
              before_data AS "beforeData",after_data AS "afterData",occurred_at AS "occurredAt"
       FROM audit_logs WHERE tenant_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT $2 OFFSET $3`,
      [tenantId, limit, offset])).rows;
  }
}
