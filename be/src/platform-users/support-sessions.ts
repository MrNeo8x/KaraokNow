import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor, AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { PG_POOL } from '../platform/database/database.module';
import { SuperAdminGuard } from './super-admin.guard';

export const SUPPORT_SESSION_MINUTES = 60;

export class StartSupportSessionDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() tenantId!: string;
  @ApiProperty({ maxLength: 500, example: 'Ticket #123: Owner báo không thấy booking hôm nay' }) @IsString() @Matches(/\S/) @MaxLength(500) reason!: string;
}
export class SupportSessionQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'all'], default: 'active' }) @IsOptional() @IsIn(['active', 'all']) status?: 'active' | 'all';
}
export class SupportSessionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty() tenantName!: string;
  @ApiProperty({ format: 'uuid' }) adminUserId!: string;
  @ApiProperty() adminDisplayName!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ format: 'date-time' }) startedAt!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) endedAt!: string | null;
  @ApiProperty({ description: 'Not ended and not expired' }) active!: boolean;
}

const FIELDS = `s.id,s.tenant_id AS "tenantId",t.name AS "tenantName",s.admin_user_id AS "adminUserId",u.display_name AS "adminDisplayName",s.reason,
  s.started_at AS "startedAt",s.expires_at AS "expiresAt",s.ended_at AS "endedAt",(s.ended_at IS NULL AND s.expires_at>clock_timestamp()) AS active`;
const FROM = 'FROM support_sessions s JOIN tenants t ON t.id=s.tenant_id JOIN users u ON u.id=s.admin_user_id';

/**
 * PD-045: a Super Admin opens a read-only support session into a merchant with a reason; it lasts 60 minutes or until ended.
 * While active, TenantGuard lets that admin read the merchant's APIs as a read-only Owner with contact data masked.
 * Start/end are audited in platform_audit_logs and in the merchant's audit log (the Owner sees who looked and why).
 */
@Injectable()
export class SupportSessionService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  async start(actor: Actor, dto: StartSupportSessionDto) {
    return this.tx(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`support:${actor.userId}:${dto.tenantId}`]);
      if (!(await client.query('SELECT 1 FROM tenants WHERE id=$1', [dto.tenantId])).rowCount) throw new NotFoundException('Merchant not found');
      const member = await client.query(`SELECT 1 FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2 AND status='ACTIVE'`, [dto.tenantId, actor.userId]);
      if (member.rowCount) throw new ForbiddenException('Use your own membership for a merchant you belong to');
      const existing = (await client.query(`SELECT id FROM support_sessions WHERE admin_user_id=$1 AND tenant_id=$2 AND ended_at IS NULL AND expires_at>clock_timestamp()`,
        [actor.userId, dto.tenantId])).rows[0];
      if (existing) return this.get(client, existing.id);
      const id = randomUUID();
      const row = (await client.query(`INSERT INTO support_sessions(id,admin_user_id,tenant_id,reason,expires_at)
        VALUES ($1,$2,$3,$4,clock_timestamp()+($5::int*interval '1 minute')) RETURNING expires_at`, [id, actor.userId, dto.tenantId, dto.reason.trim(), SUPPORT_SESSION_MINUTES])).rows[0];
      const data = { sessionId: id, expiresAt: row.expires_at, reason: dto.reason.trim() };
      await this.audit(client, actor, 'SUPPORT_SESSION_STARTED', id, dto.tenantId, data);
      return this.get(client, id);
    });
  }

  async end(actor: Actor, id: string) {
    return this.tx(async (client) => {
      const session = (await client.query(`SELECT tenant_id,admin_user_id,ended_at FROM support_sessions WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!session) throw new NotFoundException('Support session not found');
      if (!session.ended_at) {
        await client.query('UPDATE support_sessions SET ended_at=clock_timestamp() WHERE id=$1', [id]);
        await this.audit(client, actor, 'SUPPORT_SESSION_ENDED', id, session.tenant_id, { sessionId: id, endedBy: session.admin_user_id === actor.userId ? 'SELF' : 'OTHER_SUPER_ADMIN' });
      }
      return this.get(client, id);
    });
  }

  async list(status: 'active' | 'all') {
    return (await this.db.query(`SELECT ${FIELDS} ${FROM} ${status === 'active' ? 'WHERE s.ended_at IS NULL AND s.expires_at>clock_timestamp()' : ''}
      ORDER BY s.started_at DESC LIMIT 200`)).rows;
  }

  private async get(client: PoolClient, id: string) {
    return (await client.query(`SELECT ${FIELDS} ${FROM} WHERE s.id=$1`, [id])).rows[0];
  }

  private async audit(client: PoolClient, actor: Actor, action: string, id: string, tenantId: string, data: Record<string, unknown>) {
    await client.query(`INSERT INTO platform_audit_logs(id,actor_user_id,action,entity_type,entity_id,tenant_id,after_data) VALUES ($1,$2,$3,'SUPPORT_SESSION',$4,$5,$6)`,
      [randomUUID(), actor.userId, action, id, tenantId, JSON.stringify(data)]);
    await client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES ($1,$2,$3,$4,'SUPPORT_SESSION',$5,$6)`,
      [randomUUID(), tenantId, actor.userId, action, id, JSON.stringify(data)]);
  }

  private async tx<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try { await client.query('BEGIN'); const r = await work(client); await client.query('COMMIT'); return r; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}

@ApiTags('platform support') @ApiBearerAuth()
@UseGuards(AuthGuard, SuperAdminGuard) @Controller('platform/support-sessions')
export class SupportSessionController {
  constructor(private readonly sessions: SupportSessionService) {}

  @Post() @HttpCode(201)
  @ApiOperation({ description: `Opens (or returns the already active) read-only support session into a merchant for ${SUPPORT_SESSION_MINUTES} minutes. Then call merchant APIs with X-Tenant-ID = tenantId: GET only, contact data masked` })
  @ApiResponse({ status: 201, type: SupportSessionDto })
  @ApiResponse({ status: 403, description: 'Not a Super Admin, or the admin belongs to that merchant' })
  @ApiResponse({ status: 404, description: 'Merchant not found' })
  start(@Req() req: AuthenticatedRequest, @Body() dto: StartSupportSessionDto) { return this.sessions.start(req.actor, dto); }

  @Get()
  @ApiResponse({ status: 200, type: [SupportSessionDto], description: 'Latest 200 sessions of every Super Admin' })
  list(@Query() query: SupportSessionQueryDto) { return this.sessions.list(query.status ?? 'active'); }

  @Post(':id/end') @HttpCode(200)
  @ApiResponse({ status: 200, type: SupportSessionDto, description: 'Idempotent; any Super Admin may end a session' })
  end(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.sessions.end(req.actor, id); }
}
