import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';

/** PD-045: runs after AuthGuard. Super Admin = an active Platform Admin grant with super_admin = true. */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const grant = await this.db.query('SELECT 1 FROM platform_admins WHERE user_id=$1 AND revoked_at IS NULL AND super_admin', [request.actor.userId]);
    if (!grant.rowCount) throw new ForbiddenException('Super Admin role is required');
    return true;
  }
}
