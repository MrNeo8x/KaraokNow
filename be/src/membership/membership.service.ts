import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor, Role } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { CreateMembershipDto, UpdateMembershipDto } from './membership.dto';

/** Lets a caller (Platform user management, PD-040) add checks and audit inside the same transaction. */
export interface MembershipHooks {
  start?(client: PoolClient): Promise<void>;
  beforeCommit?(client: PoolClient, membershipId: string, before: MembershipRow | null, after: MembershipRow): Promise<void>;
}

export interface MembershipRow {
  id: string; userId: string; email: string; displayName: string; status: string;
  roles: Role[]; branchIds: string[];
}

@Injectable()
export class MembershipService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  async list(tenantId: string): Promise<MembershipRow[]> {
    return (await this.db.query<MembershipRow>(this.selectSql(), [tenantId])).rows;
  }

  async create(actor: Actor, dto: CreateMembershipDto, hooks: MembershipHooks = {}): Promise<MembershipRow> {
    const tenantId = actor.tenantId!;
    this.validateRoleBranches(dto.roles, dto.branchIds);
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await hooks.start?.(client);
      await this.assertBranches(client, tenantId, dto.branchIds);
      let user = await client.query<{ id: string }>('SELECT id FROM users WHERE lower(email)=lower($1)', [dto.email]);
      let userId: string;
      if (user.rowCount) {
        userId = user.rows[0].id;
      } else {
        userId = randomUUID();
        await client.query(
          `INSERT INTO users(id,email,password_hash,display_name,status,must_change_password) VALUES ($1,lower($2),$3,$4,'ACTIVE',true)`,
          [userId, dto.email, await hash(dto.temporaryPassword, 12), dto.displayName]
        );
      }
      const membershipId = randomUUID();
      await client.query(
        `INSERT INTO tenant_memberships(id,tenant_id,user_id,status) VALUES ($1,$2,$3,'ACTIVE')`,
        [membershipId, tenantId, userId]
      ).catch((error: { code?: string }) => {
        if (error.code === '23505') throw new ConflictException('User is already a tenant member');
        throw error;
      });
      await this.replaceGrants(client, membershipId, tenantId, dto.roles, dto.branchIds);
      await this.audit(client, actor, 'MEMBERSHIP_CREATED', 'MEMBERSHIP', membershipId, null,
        { email: dto.email.toLowerCase(), roles: dto.roles, branchIds: dto.branchIds, status: 'ACTIVE' });
      await hooks.beforeCommit?.(client, membershipId, null, { id: membershipId, userId, email: dto.email.toLowerCase(), displayName: dto.displayName, status: 'ACTIVE', roles: dto.roles, branchIds: dto.branchIds });
      await client.query('COMMIT');
      const created = (await this.list(tenantId)).find((item) => item.id === membershipId);
      if (!created) throw new NotFoundException('Membership not found after creation');
      return created;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async update(actor: Actor, membershipId: string, dto: UpdateMembershipDto, hooks: MembershipHooks = {}): Promise<MembershipRow> {
    const tenantId = actor.tenantId!;
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await hooks.start?.(client);
      const before = await this.getForUpdate(client, tenantId, membershipId);
      const roles = dto.roles ?? before.roles;
      const branchIds = dto.branchIds ?? before.branchIds;
      this.validateRoleBranches(roles, branchIds);
      await this.assertBranches(client, tenantId, branchIds);
      if (dto.status) await client.query(
        'UPDATE tenant_memberships SET status=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3',
        [dto.status, membershipId, tenantId]
      );
      if (dto.roles || dto.branchIds) await this.replaceGrants(client, membershipId, tenantId, roles, branchIds);
      const after = { ...before, status: dto.status ?? before.status, roles, branchIds };
      await this.audit(client, actor, 'MEMBERSHIP_UPDATED', 'MEMBERSHIP', membershipId, before, after);
      await hooks.beforeCommit?.(client, membershipId, before, after);
      await client.query('COMMIT');
      return after;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  private selectSql(): string {
    return `SELECT m.id, u.id AS "userId", u.email, u.display_name AS "displayName", m.status,
      COALESCE(array_agg(DISTINCT mr.role) FILTER (WHERE mr.role IS NOT NULL), '{}') AS roles,
      COALESCE(array_agg(DISTINCT mb.branch_id::text) FILTER (WHERE mb.branch_id IS NOT NULL), '{}') AS "branchIds"
      FROM tenant_memberships m JOIN users u ON u.id=m.user_id
      LEFT JOIN membership_roles mr ON mr.membership_id=m.id
      LEFT JOIN membership_branches mb ON mb.membership_id=m.id
      WHERE m.tenant_id=$1 GROUP BY m.id,u.id,u.email,u.display_name,m.status`;
  }

  private async getForUpdate(client: PoolClient, tenantId: string, id: string): Promise<MembershipRow> {
    const membership = await client.query<Omit<MembershipRow, 'roles' | 'branchIds'>>(
      `SELECT m.id,u.id AS "userId",u.email,u.display_name AS "displayName",m.status
       FROM tenant_memberships m JOIN users u ON u.id=m.user_id
       WHERE m.tenant_id=$1 AND m.id=$2 FOR UPDATE`, [tenantId, id]
    );
    if (!membership.rows[0]) throw new NotFoundException('Membership not found');
    const roles = await client.query<{ role: Role }>('SELECT role FROM membership_roles WHERE membership_id=$1', [id]);
    const branches = await client.query<{ branch_id: string }>('SELECT branch_id FROM membership_branches WHERE membership_id=$1', [id]);
    return { ...membership.rows[0], roles: roles.rows.map((r) => r.role), branchIds: branches.rows.map((b) => b.branch_id) };
  }

  private validateRoleBranches(roles: Role[], branchIds: string[]): void {
    const branchScoped = roles.some((r) => r !== 'OWNER');
    if (branchScoped && !roles.includes('OWNER') && branchIds.length === 0) {
      throw new BadRequestException('Branch-scoped roles require at least one branch');
    }
  }

  private async assertBranches(client: PoolClient, tenantId: string, branchIds: string[]): Promise<void> {
    if (!branchIds.length) return;
    const result = await client.query<{ id: string }>(
      'SELECT id FROM branches WHERE tenant_id=$1 AND id=ANY($2::uuid[])', [tenantId, branchIds]
    );
    if (result.rowCount !== new Set(branchIds).size) throw new BadRequestException('One or more branches are invalid');
  }

  private async replaceGrants(client: PoolClient, id: string, tenantId: string, roles: Role[], branchIds: string[]): Promise<void> {
    await client.query('DELETE FROM membership_roles WHERE membership_id=$1', [id]);
    await client.query('DELETE FROM membership_branches WHERE membership_id=$1', [id]);
    for (const role of [...new Set(roles)]) await client.query(
      'INSERT INTO membership_roles(membership_id,role) VALUES ($1,$2)', [id, role]
    );
    for (const branchId of [...new Set(branchIds)]) await client.query(
      'INSERT INTO membership_branches(membership_id,tenant_id,branch_id) VALUES ($1,$2,$3)', [id, tenantId, branchId]
    );
  }

  private audit(client: PoolClient, actor: Actor, action: string, type: string, id: string, before: unknown, after: unknown) {
    return client.query(
      `INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [randomUUID(), actor.tenantId, actor.userId, action, type, id, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]
    );
  }
}
