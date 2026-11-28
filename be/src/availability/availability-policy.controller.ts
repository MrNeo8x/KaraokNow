import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { UpdateAvailabilityPolicyDto, AvailabilityPolicyResponseDto } from './availability-policy.dto';
import { AvailabilityPolicyService } from './availability-policy.service';

@ApiTags('availability') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant/availability')
export class AvailabilityPolicyController {
  constructor(private readonly policies: AvailabilityPolicyService) {}

  @ApiResponse({ status: 200, type: AvailabilityPolicyResponseDto })
  @Get('buffer-policy') @RequireRoles('OWNER','BRANCH_MANAGER','RECEPTIONIST','CASHIER')
  getPolicy(@Req() req: AuthenticatedRequest) { return this.policies.getPolicy(req.actor.tenantId!); }

  @ApiResponse({ status: 200, type: AvailabilityPolicyResponseDto })
  @Patch('buffer-policy') @RequireRoles('OWNER','BRANCH_MANAGER')
  updatePolicy(@Req() req: AuthenticatedRequest, @Body() dto: UpdateAvailabilityPolicyDto) {
    return this.policies.updatePolicy(req.actor, dto);
  }
}
