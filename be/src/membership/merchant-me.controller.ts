import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Pool } from 'pg';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { ROLES } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { PG_POOL } from '../platform/database/database.module';
import { TenantGuard } from '../platform/tenant/tenant.guard';

export class SupportContextDto {
  @ApiProperty({ format: 'uuid' }) sessionId!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty() reason!: string;
}

export class MerchantMeDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty() tenantName!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'], description: 'INACTIVE = suspended by Platform Admin (PD-031)' }) tenantStatus!: string;
  @ApiProperty({ format: 'uuid', nullable: true, type: String, description: 'null in a Super Admin support session' }) membershipId!: string | null;
  @ApiProperty({ enum: ROLES, isArray: true }) roles!: string[];
  @ApiProperty({ type: [String], description: 'Granted branches; Owner sees every branch regardless of this list' }) branchIds!: string[];
  @ApiProperty({ description: 'True when the user also holds the global Platform Admin grant' }) platformAdmin!: boolean;
  @ApiProperty({ description: 'True in a support session: every write is rejected (PD-045)' }) readOnly!: boolean;
  @ApiProperty({ type: () => SupportContextDto, nullable: true, description: 'Set when a Super Admin is viewing through a support session' }) support!: SupportContextDto | null;
}

/**
 * Current user's identity and permissions in the selected tenant, so the UI can hide actions it would reject.
 * Authorization is still enforced by each endpoint; this is display information only.
 */
@ApiTags('memberships') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard) @Controller('merchant/me')
export class MerchantMeController {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  @Get()
  @ApiResponse({ status: 200, type: MerchantMeDto })
  @ApiResponse({ status: 403, description: 'No active membership in X-Tenant-ID' })
  async me(@Req() req: AuthenticatedRequest): Promise<MerchantMeDto> {
    const { actor } = req;
    const row = (await this.db.query(`SELECT u.email,u.display_name AS "displayName",t.name AS "tenantName",t.status AS "tenantStatus",
        EXISTS(SELECT 1 FROM platform_admins p WHERE p.user_id=u.id AND p.revoked_at IS NULL) AS "platformAdmin"
      FROM users u JOIN tenants t ON t.id=$2 WHERE u.id=$1`, [actor.userId, actor.tenantId])).rows[0];
    return {
      userId: actor.userId, email: row.email, displayName: row.displayName, tenantId: actor.tenantId!, tenantName: row.tenantName,
      tenantStatus: row.tenantStatus, membershipId: actor.membershipId ?? null, roles: [...actor.roles].sort(), branchIds: [...actor.branchIds].sort(),
      platformAdmin: row.platformAdmin, readOnly: Boolean(actor.support), support: actor.support ?? null
    };
  }
}
