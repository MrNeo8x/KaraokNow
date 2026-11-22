import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Pool } from 'pg';
import type { AuthenticatedRequest, Role } from '../auth/auth.types';
import { PG_POOL } from '../database/database.module';

export const TENANT_HEADER = 'x-tenant-id';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const value = request.headers[TENANT_HEADER];
    if (typeof value !== 'string' || !isUUID(value)) {
      throw new BadRequestException('X-Tenant-ID must be a UUID');
    }
    const membership = await this.db.query<{ id: string; roles: Role[]; branch_ids: string[] }>(
      `SELECT m.id,
              COALESCE(array_agg(DISTINCT mr.role) FILTER (WHERE mr.role IS NOT NULL), '{}') AS roles,
              COALESCE(array_agg(DISTINCT mb.branch_id::text) FILTER (WHERE mb.branch_id IS NOT NULL), '{}') AS branch_ids
       FROM tenant_memberships m
       LEFT JOIN membership_roles mr ON mr.membership_id=m.id
       LEFT JOIN membership_branches mb ON mb.membership_id=m.id
       WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='ACTIVE'
       GROUP BY m.id`,
      [value, request.actor.userId]
    );
    if (membership.rowCount !== 1) throw new ForbiddenException('No active membership for tenant');
    request.actor.tenantId = value;
    request.actor.membershipId = membership.rows[0].id;
    request.actor.roles = membership.rows[0].roles;
    request.actor.branchIds = membership.rows[0].branch_ids;
    return true;
  }
}
