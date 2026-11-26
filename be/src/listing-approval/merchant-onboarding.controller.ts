import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { CreateMerchantDto, CreatedMerchantDto, MerchantListDto, MerchantQueryDto, MerchantStatusChangeDto, MerchantSummaryDto } from './merchant-onboarding.dto';
import { MerchantOnboardingService } from './merchant-onboarding.service';
import { PlatformAdminGuard } from './platform-admin.guard';

@ApiTags('platform merchants') @ApiBearerAuth()
@UseGuards(AuthGuard, PlatformAdminGuard) @Controller('platform/merchants')
export class MerchantOnboardingController {
  constructor(private readonly merchants: MerchantOnboardingService) {}

  @Get()
  @ApiResponse({ status: 200, type: MerchantListDto })
  @ApiResponse({ status: 403, description: 'Caller is not a Platform Admin' })
  list(@Query() query: MerchantQueryDto) {
    return this.merchants.list(query);
  }

  @Post()
  @ApiResponse({ status: 201, type: CreatedMerchantDto, description: 'Active merchant with its first Owner. Catalog starts unpublished and unapproved' })
  @ApiResponse({ status: 403, description: 'Caller is not a Platform Admin' })
  @ApiResponse({ status: 409, description: 'Merchant code already in use' })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateMerchantDto) {
    return this.merchants.create(req.actor, dto);
  }

  @Post(':tenantId/suspend') @HttpCode(200)
  @ApiResponse({ status: 200, type: MerchantSummaryDto, description: 'Merchant INACTIVE: hidden from customers, no new holds; staff still operate existing holds/bookings (PD-031). Idempotent' })
  @ApiResponse({ status: 403, description: 'Not a Platform Admin, or the admin belongs to the merchant' })
  suspend(@Req() req: AuthenticatedRequest, @Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: MerchantStatusChangeDto) {
    return this.merchants.setStatus(req.actor, tenantId, 'INACTIVE', dto.reason);
  }

  @Post(':tenantId/reactivate') @HttpCode(200)
  @ApiResponse({ status: 200, type: MerchantSummaryDto, description: 'Merchant ACTIVE again; listing reappears if still published and approved. Idempotent' })
  @ApiResponse({ status: 403, description: 'Not a Platform Admin, or the admin belongs to the merchant' })
  reactivate(@Req() req: AuthenticatedRequest, @Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: MerchantStatusChangeDto) {
    return this.merchants.setStatus(req.actor, tenantId, 'ACTIVE', dto.reason);
  }
}
