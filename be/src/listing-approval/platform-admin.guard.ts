import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';

/** Runs after AuthGuard. Platform Admin is a global grant, independent of tenant membership (UAT-PD-009). */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const grant = await this.db.query('SELECT 1 FROM platform_admins WHERE user_id=$1 AND revoked_at IS NULL', [request.actor.userId]);
    if (!grant.rowCount) throw new ForbiddenException('Platform Admin role is required');
    return true;
  }
}
