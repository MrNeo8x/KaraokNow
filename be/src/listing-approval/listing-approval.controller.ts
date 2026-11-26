import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { ListingDecisionDto, ListingListDto, ListingQueryDto, ListingResponseDto, RevokeListingDto } from './listing-approval.dto';
import { ListingApprovalService } from './listing-approval.service';
import { PlatformAdminGuard } from './platform-admin.guard';

@ApiTags('platform listing approval') @ApiBearerAuth()
@UseGuards(AuthGuard, PlatformAdminGuard) @Controller('platform/catalog/listings')
export class ListingApprovalController {
  constructor(private readonly listings: ListingApprovalService) {}

  @Get()
  @ApiResponse({ status: 200, type: ListingListDto })
  @ApiResponse({ status: 403, description: 'Caller is not a Platform Admin' })
  list(@Query() query: ListingQueryDto) {
    return this.listings.list(query);
  }

  @Post(':tenantId/approve') @HttpCode(200)
  @ApiResponse({ status: 200, type: ListingResponseDto, description: 'Approved listing, or unchanged state when already approved' })
  @ApiResponse({ status: 403, description: 'Not a Platform Admin, or reviewer belongs to the merchant' })
  @ApiResponse({ status: 409, description: 'Merchant is inactive or has not published its catalog' })
  approve(@Req() req: AuthenticatedRequest, @Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: ListingDecisionDto) {
    return this.listings.approve(req.actor, tenantId, dto.note);
  }

  @Post(':tenantId/revoke') @HttpCode(200)
  @ApiResponse({ status: 200, type: ListingResponseDto, description: 'Revoked listing, or unchanged state when not approved' })
  @ApiResponse({ status: 403, description: 'Not a Platform Admin, or reviewer belongs to the merchant' })
  revoke(@Req() req: AuthenticatedRequest, @Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: RevokeListingDto) {
    return this.listings.revoke(req.actor, tenantId, dto.reason);
  }
}
