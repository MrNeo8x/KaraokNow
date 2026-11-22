import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { DepositPolicyListDto, DepositPolicyResponseDto, UpdateDepositPolicyDto } from './deposit-policy.dto';
import { PolicyListQueryDto } from './policy-list.dto';
import { DepositPolicyService } from './deposit-policy.service';

@ApiTags('booking settings') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant/booking/deposit-policy')
export class DepositPolicyController {
  constructor(private readonly service: DepositPolicyService) {}
  @Get() @RequireRoles('OWNER', 'BRANCH_MANAGER') @ApiResponse({ status: 200, type: DepositPolicyListDto, description: 'Explicitly configured channels only' })
  list(@Req() req: AuthenticatedRequest, @Query() query: PolicyListQueryDto) { return this.service.list(req.actor, query); }
  @Get(':channel') @RequireRoles('OWNER', 'BRANCH_MANAGER') @ApiResponse({ status: 200, type: DepositPolicyResponseDto })
  get(@Req() req: AuthenticatedRequest, @Param('channel') channel: string) { return this.service.get(req.actor, channel); }
  @Patch(':channel') @RequireRoles('OWNER', 'BRANCH_MANAGER') @ApiResponse({ status: 200, type: DepositPolicyResponseDto })
  update(@Req() req: AuthenticatedRequest, @Param('channel') channel: string, @Body() dto: UpdateDepositPolicyDto) {
    return this.service.update(req.actor, channel, dto);
  }
}
