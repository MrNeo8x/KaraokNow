import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Pool } from 'pg';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { ROLES } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { PG_POOL } from '../platform/database/database.module';

export class MyTenantDto {
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty() tenantName!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'], description: 'INACTIVE = suspended by Platform Admin (PD-031); staff can still work on existing holds/bookings' }) tenantStatus!: string;
  @ApiProperty({ enum: ROLES, isArray: true }) roles!: string[];
}

/**
 * FE-012 / PD-039: merchants the signed-in user can open, so the UI can pick one instead of asking for a tenant UUID.
 * No X-Tenant-ID: it lists only the caller's own ACTIVE memberships (name, status, roles; no other members' data).
 */
@ApiTags('memberships') @ApiBearerAuth() @UseGuards(AuthGuard) @Controller('me/tenants')
export class MyTenantsController {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  @Get()
  @ApiResponse({ status: 200, type: [MyTenantDto] })
  async list(@Req() req: AuthenticatedRequest): Promise<MyTenantDto[]> {
    return (await this.db.query(`SELECT t.id AS "tenantId",t.name AS "tenantName",t.status AS "tenantStatus",
        COALESCE(array_agg(DISTINCT mr.role ORDER BY mr.role) FILTER (WHERE mr.role IS NOT NULL),'{}') AS roles
      FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id LEFT JOIN membership_roles mr ON mr.membership_id=m.id
      WHERE m.user_id=$1 AND m.status='ACTIVE' GROUP BY t.id,t.name,t.status ORDER BY t.name,t.id`, [req.actor.userId])).rows;
  }
}
