import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { ListingQueryDto } from './listing-approval.dto';

const listingFields = `c.tenant_id AS "tenantId",t.code AS "merchantCode",t.name AS "merchantName",t.status AS "tenantStatus",c.published,
  c.platform_approved AS "platformApproved",c.platform_decided_by AS "platformDecidedBy",c.platform_decided_at AS "platformDecidedAt",
  (SELECT count(*)::int FROM branches b WHERE b.tenant_id=c.tenant_id AND b.status='ACTIVE') AS "activeBranchCount",
  c.public_booking_terms IS NOT NULL AS "termsConfigured",c.updated_at AS "updatedAt",c.version::text`;

@Injectable()
export class ListingApprovalService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  async list(query: ListingQueryDto) {
    const status = query.status ?? 'PENDING', limit = query.limit ?? 50, offset = query.offset ?? 0;
    const filter = status === 'PENDING' ? 'AND c.published=true AND c.platform_approved=false'
      : status === 'APPROVED' ? 'AND c.platform_approved=true' : '';
    const rows = (await this.db.query(`SELECT ${listingFields} FROM tenant_public_catalog c JOIN tenants t ON t.id=c.tenant_id
      WHERE true ${filter} ORDER BY c.updated_at,c.tenant_id LIMIT $1 OFFSET $2`, [limit + 1, offset])).rows;
    return { items: rows.slice(0, limit), limit, offset, hasMore: rows.length > limit };
  }

  async approve(actor: Actor, tenantId: string, note?: string) {
    return this.decide(actor, tenantId, true, note ?? null);
  }

  async revoke(actor: Actor, tenantId: string, reason: string) {
    return this.decide(actor, tenantId, false, reason);
  }

  private async decide(actor: Actor, tenantId: string, approve: boolean, note: string | null) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      // Same lock as merchant publication changes, so approval and publish/unpublish cannot interleave.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`catalog:${tenantId}`]);
      const current = (await client.query(`SELECT c.published,c.platform_approved AS "platformApproved",c.version::text,t.status AS "tenantStatus"
        FROM tenant_public_catalog c JOIN tenants t ON t.id=c.tenant_id WHERE c.tenant_id=$1 FOR UPDATE OF c`, [tenantId])).rows[0];
      if (!current) throw new NotFoundException('Merchant listing not found');
      await this.assertNotSelfReview(client, actor, tenantId);
      if (current.platformApproved === approve) {
        const unchanged = await this.find(client, tenantId);
        await client.query('COMMIT'); return unchanged;
      }
      if (approve && (!current.published || current.tenantStatus !== 'ACTIVE')) throw new ConflictException('Only an active merchant that has published its catalog can be approved');
      await client.query(`UPDATE tenant_public_catalog SET platform_approved=$2,platform_decided_by=$3,platform_decided_at=clock_timestamp(),
        updated_at=clock_timestamp(),version=version+1 WHERE tenant_id=$1`, [tenantId, approve, actor.userId]);
      const after = await this.find(client, tenantId);
      await client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
        VALUES($1,$2,$3,$4,'PUBLIC_CATALOG',$2,$5,$6)`,
      [randomUUID(), tenantId, actor.userId, approve ? 'PLATFORM_LISTING_APPROVED' : 'PLATFORM_LISTING_REVOKED',
        JSON.stringify({ published: current.published, platformApproved: current.platformApproved, version: current.version }),
        JSON.stringify({ published: after.published, platformApproved: after.platformApproved, version: after.version, note })]);
      await client.query('COMMIT'); return after;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  /** Merchant users cannot approve themselves: a Platform Admin with any active membership in the tenant is rejected. */
  private async assertNotSelfReview(client: PoolClient, actor: Actor, tenantId: string) {
    const member = await client.query(`SELECT 1 FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2 AND status='ACTIVE'`, [tenantId, actor.userId]);
    if (member.rowCount) throw new ForbiddenException('Platform Admin cannot review a merchant they belong to');
  }

  private async find(client: PoolClient, tenantId: string) {
    return (await client.query(`SELECT ${listingFields} FROM tenant_public_catalog c JOIN tenants t ON t.id=c.tenant_id WHERE c.tenant_id=$1`, [tenantId])).rows[0];
  }
}
