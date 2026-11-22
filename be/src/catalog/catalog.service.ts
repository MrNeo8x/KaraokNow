import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { CatalogQueryDto } from './catalog.dto';

@Injectable()
export class CatalogService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}
  async getPublication(actor: Actor) {
    return (await this.db.query(`SELECT published,platform_approved AS "platformApproved",version::text FROM tenant_public_catalog WHERE tenant_id=$1`, [actor.tenantId])).rows[0] ?? { published: false, platformApproved: false };
  }
  async setPublication(actor: Actor, published: boolean) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`catalog:${actor.tenantId}`]);
      const before = (await client.query(`SELECT published,platform_approved AS "platformApproved",version::text FROM tenant_public_catalog WHERE tenant_id=$1 FOR UPDATE`, [actor.tenantId])).rows[0] ?? { published: false, platformApproved: false };
      const after = (await client.query(`INSERT INTO tenant_public_catalog(tenant_id,published,updated_by) VALUES($1,$2,$3)
        ON CONFLICT(tenant_id) DO UPDATE SET published=EXCLUDED.published,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp(),version=tenant_public_catalog.version+1
        RETURNING published,platform_approved AS "platformApproved",version::text`, [actor.tenantId,published,actor.userId])).rows[0];
      await client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
        VALUES($1,$2,$3,'PUBLIC_CATALOG_UPDATED','PUBLIC_CATALOG',$2,$4,$5)`, [randomUUID(),actor.tenantId,actor.userId,JSON.stringify(before),JSON.stringify(after)]);
      await client.query('COMMIT'); return after;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async branches(query: CatalogQueryDto) {
    const limit = query.limit ?? 50, offset = query.offset ?? 0;
    const rows = (await this.db.query(`SELECT b.id,t.id AS "merchantId",t.name AS "merchantName",b.name,b.timezone
      FROM branches b JOIN tenants t ON t.id=b.tenant_id JOIN tenant_public_catalog c ON c.tenant_id=t.id
      WHERE c.published=true AND c.platform_approved=true AND t.status='ACTIVE' AND b.status='ACTIVE'
      ORDER BY b.name,b.id LIMIT $1 OFFSET $2`, [limit+1,offset])).rows;
    return { items: rows.slice(0,limit), limit, offset, hasMore: rows.length > limit };
  }
  async rooms(branchId: string, query: CatalogQueryDto) {
    const visible = await this.db.query(`SELECT 1 FROM branches b JOIN tenants t ON t.id=b.tenant_id JOIN tenant_public_catalog c ON c.tenant_id=t.id
      WHERE b.id=$1 AND b.status='ACTIVE' AND t.status='ACTIVE' AND c.published=true AND c.platform_approved=true`, [branchId]);
    if (!visible.rowCount) throw new NotFoundException('Published branch not found');
    const limit = query.limit ?? 50, offset = query.offset ?? 0;
    const rows = (await this.db.query(`SELECT r.id,r.branch_id AS "branchId",r.name,r.capacity FROM rooms r
      JOIN branches b ON b.id=r.branch_id AND b.tenant_id=r.tenant_id JOIN tenants t ON t.id=b.tenant_id JOIN tenant_public_catalog c ON c.tenant_id=t.id
      WHERE r.branch_id=$1 AND r.status='ACTIVE' AND b.status='ACTIVE' AND t.status='ACTIVE' AND c.published=true AND c.platform_approved=true
      ORDER BY r.name,r.id LIMIT $2 OFFSET $3`, [branchId,limit+1,offset])).rows;
    return { items: rows.slice(0,limit), limit, offset, hasMore: rows.length > limit };
  }
}
