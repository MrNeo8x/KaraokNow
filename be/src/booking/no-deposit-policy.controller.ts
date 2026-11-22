import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { NoDepositPolicyListDto, NoDepositPolicyResponseDto, UpdateNoDepositPolicyDto } from './no-deposit-policy.dto';
import { PolicyListQueryDto } from './policy-list.dto';
import { NoDepositPolicyService } from './no-deposit-policy.service';

@ApiTags('booking settings') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant/booking/no-deposit-confirmation')
export class NoDepositPolicyController {
  constructor(private readonly service: NoDepositPolicyService) {}
  @Get() @RequireRoles('OWNER', 'BRANCH_MANAGER') @ApiResponse({ status: 200, type: NoDepositPolicyListDto, description: 'Explicitly configured channels only' })
  list(@Req() req: AuthenticatedRequest, @Query() query: PolicyListQueryDto) { return this.service.list(req.actor, query); }
  @Get(':channel') @RequireRoles('OWNER', 'BRANCH_MANAGER')
  @ApiResponse({ status: 200, type: NoDepositPolicyResponseDto })
  get(@Req() req: AuthenticatedRequest, @Param('channel') channel: string) { return this.service.get(req.actor, channel); }
  @Patch(':channel') @RequireRoles('OWNER', 'BRANCH_MANAGER')
  @ApiResponse({ status: 200, type: NoDepositPolicyResponseDto })
  update(@Req() req: AuthenticatedRequest, @Param('channel') channel: string, @Body() dto: UpdateNoDepositPolicyDto) {
    return this.service.update(req.actor, channel, dto.allowed);
  }
}
