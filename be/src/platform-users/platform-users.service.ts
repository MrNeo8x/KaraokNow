import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { randomInt, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { MembershipService, type MembershipHooks, type MembershipRow } from '../membership/membership.service';
import { PlatformCreateMembershipDto, PlatformUpdateMembershipDto, PlatformUserQueryDto } from './platform-users.dto';

/** Readable temporary password alphabet: no 0/O/1/l/I. 16 symbols from 55 ≈ 92 bits. */
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const PLATFORM_ADMIN_LOCK = 'platform-admins';

const USER_FIELDS = `u.id,u.email,u.display_name AS "displayName",u.status,u.must_change_password AS "mustChangePassword",
  EXISTS(SELECT 1 FROM platform_admins p WHERE p.user_id=u.id AND p.revoked_at IS NULL) AS "platformAdmin",
  EXISTS(SELECT 1 FROM platform_admins p WHERE p.user_id=u.id AND p.revoked_at IS NULL AND p.super_admin) AS "superAdmin",
  u.created_at AS "createdAt",
  (SELECT max(e.occurred_at) FROM auth_security_events e WHERE e.user_id=u.id AND e.event='LOGIN_SUCCEEDED') AS "lastLoginAt",
  u.disabled_at AS "disabledAt",u.disabled_reason AS "disabledReason",
  COALESCE((SELECT json_agg(json_build_object('membershipId',m.id,'tenantId',t.id,'tenantName',t.name,'tenantStatus',t.status,'status',m.status,
      'roles',COALESCE((SELECT array_agg(mr.role ORDER BY mr.role) FROM membership_roles mr WHERE mr.membership_id=m.id),'{}'),
      'branchIds',COALESCE((SELECT array_agg(mb.branch_id::text ORDER BY mb.branch_id) FROM membership_branches mb WHERE mb.membership_id=m.id),'{}'))
    ORDER BY t.name,t.id) FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=u.id),'[]') AS memberships`;

/**
 * PD-040: Platform Admin user management — search users, disable/enable, issue a temporary password (support path of PD-014),
 * grant/revoke Platform Admin, and edit merchant memberships. Every change is audited in `platform_audit_logs` with the
 * operator's reason; passwords, emails and phone numbers are never written to audit data. An admin cannot act on their own
 * account (no self-lockout), and cannot edit memberships of a merchant they belong to (same rule as PD-031).
 */
@Injectable()
export class PlatformUsersService {
  constructor(@Inject(PG_POOL) private readonly db: Pool, private readonly memberships: MembershipService) {}

  async list(query: PlatformUserQueryDto) {
    const limit = query.limit ?? 50, offset = query.offset ?? 0;
    const params: unknown[] = [];
    const where: string[] = [];
    if (query.q?.trim()) {
      params.push(`%${query.q.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(`(lower(u.email) LIKE $${params.length} OR lower(u.display_name) LIKE $${params.length})`);
    }
    if (query.status && query.status !== 'ALL') { params.push(query.status); where.push(`u.status=$${params.length}`); }
    if (query.platformAdmin !== undefined) {
      where.push(`${query.platformAdmin ? '' : 'NOT '}EXISTS(SELECT 1 FROM platform_admins p WHERE p.user_id=u.id AND p.revoked_at IS NULL)`);
    }
    params.push(limit + 1, offset);
    const rows = (await this.db.query(`SELECT ${USER_FIELDS} FROM users u ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY lower(u.email),u.id LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
    return { items: rows.slice(0, limit), limit, offset, hasMore: rows.length > limit };
  }

  async get(userId: string, client: Pool | PoolClient = this.db) {
    const user = (await client.query(`SELECT ${USER_FIELDS} FROM users u WHERE u.id=$1`, [userId])).rows[0];
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async setStatus(actor: Actor, userId: string, status: 'ACTIVE' | 'DISABLED', reason: string) {
    this.assertNotSelf(actor, userId);
    return this.tx(async (client) => {
      const current = await this.lockUser(client, userId);
      if (current.status !== status) {
        if (status === 'DISABLED') {
          await client.query(`UPDATE users SET status='DISABLED',disabled_at=clock_timestamp(),disabled_by=$2,disabled_reason=$3,updated_at=now() WHERE id=$1`,
            [userId, actor.userId, reason.trim()]);
          await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1', [userId]);
        } else {
          await client.query(`UPDATE users SET status='ACTIVE',disabled_at=NULL,disabled_by=NULL,disabled_reason=NULL,updated_at=now() WHERE id=$1`, [userId]);
        }
        await this.audit(client, actor, status === 'DISABLED' ? 'USER_DISABLED' : 'USER_ENABLED', 'USER', userId, null,
          { status: current.status }, { status, reason: reason.trim() });
      }
      return this.get(userId, client);
    });
  }

  async issueTemporaryPassword(actor: Actor, userId: string, reason: string) {
    this.assertNotSelf(actor, userId);
    const temporaryPassword = Array.from({ length: 16 }, () => TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)]).join('');
    const passwordHash = await hash(temporaryPassword, 12);
    return this.tx(async (client) => {
      const current = await this.lockUser(client, userId);
      if (current.status !== 'ACTIVE') throw new ConflictException('Enable the user before issuing a temporary password');
      await client.query(`UPDATE users SET password_hash=$2,must_change_password=true,password_changed_at=now(),updated_at=now() WHERE id=$1`, [userId, passwordHash]);
      await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1', [userId]);
      await client.query('DELETE FROM auth_login_throttles WHERE email=$1', [current.email]);
      await client.query('INSERT INTO auth_security_events(id,user_id,event) VALUES ($1,$2,$3)', [randomUUID(), userId, 'TEMPORARY_PASSWORD_ISSUED']);
      await this.audit(client, actor, 'USER_TEMPORARY_PASSWORD_ISSUED', 'USER', userId, null, null, { mustChangePassword: true, reason: reason.trim() });
      return { temporaryPassword, user: await this.get(userId, client) };
    });
  }

  async setPlatformAdmin(actor: Actor, userId: string, grant: boolean, reason: string) {
    if (!grant) this.assertNotSelf(actor, userId);
    return this.tx(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [PLATFORM_ADMIN_LOCK]);
      const current = await this.lockUser(client, userId);
      const active = (await client.query('SELECT 1 FROM platform_admins WHERE user_id=$1 AND revoked_at IS NULL', [userId])).rowCount === 1;
      if (grant && !active) {
        if (current.status !== 'ACTIVE') throw new ConflictException('Only active users can become Platform Admin');
        await client.query(`INSERT INTO platform_admins(user_id,granted_at,granted_by) VALUES ($1,clock_timestamp(),$2)
          ON CONFLICT (user_id) DO UPDATE SET granted_at=clock_timestamp(),granted_by=$2,revoked_at=NULL,revoked_by=NULL`, [userId, actor.userId]);
      } else if (!grant && active) {
        const remaining = (await client.query(`SELECT count(*)::int AS n FROM platform_admins p JOIN users u ON u.id=p.user_id
          WHERE p.revoked_at IS NULL AND u.status='ACTIVE' AND p.user_id<>$1`, [userId])).rows[0].n;
        if (remaining < 1) throw new ConflictException('At least one active Platform Admin must remain');
        const supers = (await client.query(`SELECT count(*)::int AS n FROM platform_admins p JOIN users u ON u.id=p.user_id
          WHERE p.revoked_at IS NULL AND p.super_admin AND u.status='ACTIVE' AND p.user_id<>$1`, [userId])).rows[0].n;
        const isSuper = (await client.query('SELECT super_admin FROM platform_admins WHERE user_id=$1', [userId])).rows[0]?.super_admin;
        if (isSuper && supers < 1) throw new ConflictException('At least one active Super Admin must remain');
        await client.query('UPDATE platform_admins SET revoked_at=clock_timestamp(),revoked_by=$2,super_admin=false WHERE user_id=$1', [userId, actor.userId]);
      }
      if (grant !== active) {
        await this.audit(client, actor, grant ? 'PLATFORM_ADMIN_GRANTED' : 'PLATFORM_ADMIN_REVOKED', 'USER', userId, null,
          { platformAdmin: active }, { platformAdmin: grant, reason: reason.trim() });
      }
      return this.get(userId, client);
    });
  }

  /** PD-045: only a Super Admin may change Super Admin (enforced by the controller guard); target must be an active Platform Admin. */
  async setSuperAdmin(actor: Actor, userId: string, grant: boolean, reason: string) {
    if (!grant) this.assertNotSelf(actor, userId);
    return this.tx(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [PLATFORM_ADMIN_LOCK]);
      await this.lockUser(client, userId);
      const grantRow = (await client.query('SELECT super_admin FROM platform_admins WHERE user_id=$1 AND revoked_at IS NULL', [userId])).rows[0];
      if (!grantRow) throw new ConflictException('Grant Platform Admin first');
      if (grantRow.super_admin !== grant) {
        if (!grant) {
          const others = (await client.query(`SELECT count(*)::int AS n FROM platform_admins p JOIN users u ON u.id=p.user_id
            WHERE p.revoked_at IS NULL AND p.super_admin AND u.status='ACTIVE' AND p.user_id<>$1`, [userId])).rows[0].n;
          if (others < 1) throw new ConflictException('At least one active Super Admin must remain');
          await client.query('UPDATE support_sessions SET ended_at=clock_timestamp() WHERE admin_user_id=$1 AND ended_at IS NULL', [userId]);
        }
        await client.query('UPDATE platform_admins SET super_admin=$2 WHERE user_id=$1', [userId, grant]);
        await this.audit(client, actor, grant ? 'SUPER_ADMIN_GRANTED' : 'SUPER_ADMIN_REVOKED', 'USER', userId, null, { superAdmin: !grant }, { superAdmin: grant, reason: reason.trim() });
      }
      return this.get(userId, client);
    });
  }

  async listMemberships(tenantId: string) {
    await this.assertTenant(this.db, tenantId);
    return this.memberships.list(tenantId);
  }

  async branches(tenantId: string) {
    await this.assertTenant(this.db, tenantId);
    return (await this.db.query(`SELECT id,name,status FROM branches WHERE tenant_id=$1 ORDER BY name,id`, [tenantId])).rows;
  }

  async createMembership(actor: Actor, tenantId: string, dto: PlatformCreateMembershipDto) {
    await this.assertNotMember(actor, tenantId); // authorization before payload validation (403 before 400)
    const { reason, ...membership } = dto;
    return this.memberships.create(this.tenantActor(actor, tenantId), membership as PlatformCreateMembershipDto,
      this.membershipHooks(actor, tenantId, 'PLATFORM_MEMBERSHIP_CREATED', reason));
  }

  async updateMembership(actor: Actor, tenantId: string, membershipId: string, dto: PlatformUpdateMembershipDto) {
    await this.assertNotMember(actor, tenantId);
    const { reason, ...changes } = dto;
    if (changes.status === undefined && changes.roles === undefined && changes.branchIds === undefined) {
      throw new BadRequestException('Nothing to change');
    }
    return this.memberships.update(this.tenantActor(actor, tenantId), membershipId, changes,
      this.membershipHooks(actor, tenantId, 'PLATFORM_MEMBERSHIP_UPDATED', reason));
  }

  private membershipHooks(actor: Actor, tenantId: string, action: string, reason: string): MembershipHooks {
    return {
      start: async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`memberships:${tenantId}`]);
        await this.assertTenant(client, tenantId);
        const member = await client.query(`SELECT 1 FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2 AND status='ACTIVE'`, [tenantId, actor.userId]);
        if (member.rowCount) throw new ForbiddenException('Platform Admin cannot edit memberships of a merchant they belong to');
      },
      beforeCommit: async (client, membershipId, before: MembershipRow | null, after: MembershipRow) => {
        const owners = (await client.query(`SELECT count(*)::int AS n FROM tenant_memberships m JOIN membership_roles r ON r.membership_id=m.id
          JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.status='ACTIVE' AND r.role='OWNER'`, [tenantId])).rows[0].n;
        if (owners < 1) throw new ConflictException('The merchant must keep at least one active Owner');
        const shape = (row: MembershipRow | null) => row && { userId: row.userId, status: row.status, roles: [...row.roles].sort(), branchIds: [...row.branchIds].sort() };
        await this.audit(client, actor, action, 'MEMBERSHIP', membershipId, tenantId, shape(before), { ...shape(after), reason: reason.trim() });
      }
    };
  }

  private async assertNotMember(actor: Actor, tenantId: string) {
    const member = await this.db.query(`SELECT 1 FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2 AND status='ACTIVE'`, [tenantId, actor.userId]);
    if (member.rowCount) throw new ForbiddenException('Platform Admin cannot edit memberships of a merchant they belong to');
  }

  private tenantActor(actor: Actor, tenantId: string): Actor {
    return { userId: actor.userId, tenantId, roles: ['OWNER'], branchIds: [] };
  }

  private async assertTenant(client: Pool | PoolClient, tenantId: string) {
    if (!(await client.query('SELECT 1 FROM tenants WHERE id=$1', [tenantId])).rowCount) throw new NotFoundException('Merchant not found');
  }

  private assertNotSelf(actor: Actor, userId: string) {
    if (actor.userId === userId) throw new ForbiddenException('Platform Admin cannot perform this action on their own account');
  }

  private async lockUser(client: PoolClient, userId: string) {
    const user = (await client.query<{ status: string; email: string }>('SELECT status,email FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private audit(client: PoolClient, actor: Actor, action: string, type: string, id: string, tenantId: string | null, before: unknown, after: unknown) {
    return client.query(`INSERT INTO platform_audit_logs(id,actor_user_id,action,entity_type,entity_id,tenant_id,before_data,after_data)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [randomUUID(), actor.userId, action, type, id, tenantId, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]);
  }

  private async tx<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
