import { Body, Controller, Get, Inject, Injectable, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Actor, AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { PG_POOL } from '../platform/database/database.module';
import { TenantGuard } from '../platform/tenant/tenant.guard';

/** PD-030 default grace before late check-out counts as overtime. */
export const DEFAULT_OVERTIME_GRACE_MINUTES = 10;

export class UpdateOvertimePolicyDto {
  @ApiProperty({ minimum: 0, maximum: 60, default: DEFAULT_OVERTIME_GRACE_MINUTES }) @IsInt() @Min(0) @Max(60) graceMinutes!: number;
}

export class OvertimePolicyDto {
  @ApiProperty({ description: 'False when the merchant has not saved a value and the default applies' }) configured!: boolean;
  @ApiProperty({ description: 'Late check-out within this many minutes after the scheduled end is not overtime' }) graceMinutes!: number;
  @ApiProperty({ nullable: true, type: String }) version!: string | null;
}

@Injectable()
export class OvertimePolicyService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  async get(tenantId: string): Promise<OvertimePolicyDto> {
    const row = (await this.db.query(`SELECT grace_minutes AS "graceMinutes",version::text FROM tenant_overtime_policies WHERE tenant_id=$1`, [tenantId])).rows[0];
    return row ? { configured: true, ...row } : { configured: false, graceMinutes: DEFAULT_OVERTIME_GRACE_MINUTES, version: null };
  }

  async update(actor: Actor, dto: UpdateOvertimePolicyDto): Promise<OvertimePolicyDto> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const before = (await client.query(`SELECT grace_minutes AS "graceMinutes",version::text FROM tenant_overtime_policies WHERE tenant_id=$1 FOR UPDATE`, [actor.tenantId])).rows[0]
        ?? { graceMinutes: DEFAULT_OVERTIME_GRACE_MINUTES, version: null };
      const after = (await client.query(`INSERT INTO tenant_overtime_policies(tenant_id,grace_minutes,updated_by) VALUES($1,$2,$3)
        ON CONFLICT(tenant_id) DO UPDATE SET grace_minutes=EXCLUDED.grace_minutes,updated_by=EXCLUDED.updated_by,updated_at=now(),version=tenant_overtime_policies.version+1
        RETURNING grace_minutes AS "graceMinutes",version::text`, [actor.tenantId, dto.graceMinutes, actor.userId])).rows[0];
      await client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
        VALUES($1,$2,$3,'OVERTIME_POLICY_UPDATED','OVERTIME_POLICY',$2,$4,$5)`, [randomUUID(), actor.tenantId, actor.userId, JSON.stringify(before), JSON.stringify(after)]);
      await client.query('COMMIT');
      return { configured: true, ...after };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}

@ApiTags('bookings') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant/booking/overtime-policy')
export class OvertimePolicyController {
  constructor(private readonly policies: OvertimePolicyService) {}

  @Get() @RequireRoles('OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST', 'CASHIER')
  @ApiResponse({ status: 200, type: OvertimePolicyDto })
  get(@Req() req: AuthenticatedRequest) { return this.policies.get(req.actor.tenantId!); }

  @Patch() @RequireRoles('OWNER', 'BRANCH_MANAGER')
  @ApiResponse({ status: 200, type: OvertimePolicyDto })
  update(@Req() req: AuthenticatedRequest, @Body() dto: UpdateOvertimePolicyDto) { return this.policies.update(req.actor, dto); }
}
