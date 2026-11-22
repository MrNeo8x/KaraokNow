import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Pool } from 'pg';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { PG_POOL } from '../platform/database/database.module';
import { TenantGuard } from '../platform/tenant/tenant.guard';

class OutboxBacklogDto {
  @ApiProperty({ description: 'PENDING events, including delayed retries; decimal string' }) pendingCount!: string;
  @ApiProperty({ description: 'Currently PROCESSING events; decimal string' }) processingCount!: string;
  @ApiProperty({ description: 'DEAD events; decimal string' }) deadCount!: string;
  @ApiProperty({ nullable: true, type: Number, description: 'Seconds since the oldest ready PENDING event was created, or null' }) oldestReadySeconds!: number | null;
}

@ApiTags('notification operations') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant/notifications/outbox')
export class OutboxStatusController {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}
  @Get('backlog') @RequireRoles('OWNER')
  @ApiResponse({ status: 200, type: OutboxBacklogDto, description: 'Tenant-scoped outbox counts; no payloads or recipients' })
  async backlog(@Req() req: AuthenticatedRequest): Promise<OutboxBacklogDto> {
    const result = await this.db.query<OutboxBacklogDto>(`SELECT
      count(*) FILTER (WHERE status='PENDING')::text AS "pendingCount",
      count(*) FILTER (WHERE status='PROCESSING')::text AS "processingCount",
      count(*) FILTER (WHERE status='DEAD')::text AS "deadCount",
      extract(epoch FROM (statement_timestamp()-min(created_at) FILTER (WHERE status='PENDING' AND available_at<=statement_timestamp())))::double precision AS "oldestReadySeconds"
      FROM outbox_events WHERE tenant_id=$1`, [req.actor.tenantId]);
    return result.rows[0];
  }
}
