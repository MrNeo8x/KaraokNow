import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import type { AuthenticatedRequest } from './auth.types';
import { ALLOW_PASSWORD_CHANGE } from './password-change.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, @Inject(PG_POOL) private readonly db: Pool,
              private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Bearer token is required');
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; sid: string }>(header.slice(7));
      const session = (await this.db.query<{ must_change_password: boolean }>(
        `SELECT u.must_change_password FROM auth_sessions s JOIN users u ON u.id=s.user_id
         WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='ACTIVE'`,
        [payload.sid, payload.sub])).rows[0];
      if (!session) throw new UnauthorizedException('Session is not active');
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE, [context.getHandler(), context.getClass()]);
      if (session.must_change_password && !allowed) throw new ForbiddenException('Password change is required');
      request.actor = { userId: payload.sub, sessionId: payload.sid, roles: [], branchIds: [] };
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
