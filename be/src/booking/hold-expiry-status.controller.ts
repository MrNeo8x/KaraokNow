import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { HoldService } from './hold.service';

class HoldExpiryBacklogDto {
  @ApiProperty({ description: 'Number of overdue holds still awaiting expiration, as a decimal string' }) overdueCount!: string;
  @ApiProperty({ nullable: true, type: Number, description: 'Age in seconds of the oldest overdue hold; null if none' }) oldestOverdueSeconds!: number | null;
}
@ApiTags('booking operations') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant/booking/hold-expiry')
export class HoldExpiryStatusController {
  constructor(private readonly holds: HoldService) {}
  @Get('backlog') @RequireRoles('OWNER')
  @ApiResponse({ status: 200, type: HoldExpiryBacklogDto, description: 'Tenant-scoped overdue holds; this endpoint does not expire them' })
  backlog(@Req() req: AuthenticatedRequest) { return this.holds.expiryBacklog(req.actor); }
}
