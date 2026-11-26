import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { CreateMerchantDto, CreatedMerchantDto, MerchantListDto, MerchantQueryDto } from './merchant-onboarding.dto';
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
}
