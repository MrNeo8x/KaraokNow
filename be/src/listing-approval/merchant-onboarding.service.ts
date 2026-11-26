import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { CreateMerchantDto, MerchantQueryDto } from './merchant-onboarding.dto';

const summaryFields = `t.id AS "tenantId",t.code,t.name,t.status,t.created_at AS "createdAt",
  (SELECT count(DISTINCT m.id)::int FROM tenant_memberships m JOIN membership_roles r ON r.membership_id=m.id
    WHERE m.tenant_id=t.id AND m.status='ACTIVE' AND r.role='OWNER') AS "ownerCount",
  (SELECT count(*)::int FROM branches b WHERE b.tenant_id=t.id AND b.status='ACTIVE') AS "activeBranchCount",
  COALESCE(c.published,false) AS published,COALESCE(c.platform_approved,false) AS "platformApproved"`;

/** Manual merchant onboarding by a Platform Admin (PD-029): one tenant plus its first Owner, no self-service sign-up. */
@Injectable()
export class MerchantOnboardingService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  async list(query: MerchantQueryDto) {
    const status = query.status ?? 'ALL', limit = query.limit ?? 50, offset = query.offset ?? 0;
    const rows = (await this.db.query(`SELECT ${summaryFields} FROM tenants t LEFT JOIN tenant_public_catalog c ON c.tenant_id=t.id
      WHERE ($1='ALL' OR t.status=$1) ORDER BY t.created_at DESC,t.id LIMIT $2 OFFSET $3`, [status, limit + 1, offset])).rows;
    return { items: rows.slice(0, limit), limit, offset, hasMore: rows.length > limit };
  }

  async create(actor: Actor, dto: CreateMerchantDto) {
    const email = dto.owner.email.toLowerCase();
    // Hash before opening the transaction: bcrypt is slow and must not hold row locks.
    const passwordHash = await hash(dto.owner.temporaryPassword, 12);
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`merchant-code:${dto.code}`]);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`user-email:${email}`]);
      if ((await client.query('SELECT 1 FROM tenants WHERE code=$1', [dto.code])).rowCount) throw new ConflictException('Merchant code is already in use');
      const tenantId = randomUUID();
      await client.query(`INSERT INTO tenants(id,code,name,status) VALUES($1,$2,$3,'ACTIVE')`, [tenantId, dto.code, dto.name.trim()]);
      const existing = (await client.query<{ id: string }>('SELECT id FROM users WHERE lower(email)=$1', [email])).rows[0];
      const userId = existing?.id ?? randomUUID();
      if (!existing) {
        await client.query(`INSERT INTO users(id,email,password_hash,display_name,status,must_change_password) VALUES($1,$2,$3,$4,'ACTIVE',true)`,
          [userId, email, passwordHash, dto.owner.displayName.trim()]);
      }
      const membershipId = randomUUID();
      await client.query(`INSERT INTO tenant_memberships(id,tenant_id,user_id,status) VALUES($1,$2,$3,'ACTIVE')`, [membershipId, tenantId, userId]);
      await client.query(`INSERT INTO membership_roles(membership_id,role) VALUES($1,'OWNER')`, [membershipId]);
      await client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,$3,'MERCHANT_CREATED','TENANT',$2,$4)`,
        [randomUUID(), tenantId, actor.userId, JSON.stringify({ code: dto.code, name: dto.name.trim(), status: 'ACTIVE', ownerUserId: userId, ownerMembershipId: membershipId, ownerAccountCreated: !existing })]);
      const summary = await this.summary(client, tenantId);
      await client.query('COMMIT');
      return { ...summary, owner: { userId, email, membershipId, accountCreated: !existing } };
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') throw new ConflictException('Merchant code is already in use');
      throw error;
    } finally { client.release(); }
  }

  private async summary(client: PoolClient, tenantId: string) {
    return (await client.query(`SELECT ${summaryFields} FROM tenants t LEFT JOIN tenant_public_catalog c ON c.tenant_id=t.id WHERE t.id=$1`, [tenantId])).rows[0];
  }
}
