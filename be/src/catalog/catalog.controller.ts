import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { CatalogQueryDto, PublicationResponseDto, PublicAvailabilityResponseDto, PublicBookingTermsResponseDto, PublicBranchListDto, PublicQuoteResponseDto, PublicRoomListDto, UpdatePublicBookingTermsDto, UpdatePublicationDto } from './catalog.dto';
import { CatalogService } from './catalog.service';
import { AvailabilitySearchDto } from '../availability/availability-search.dto';
import { QuoteRequestDto } from '../pricing/pricing.dto';

@ApiTags('public catalog') @Controller('public')
export class PublicCatalogController {
  constructor(private readonly catalog: CatalogService) {}
  @Get('branches') @ApiResponse({ status: 200, type: PublicBranchListDto })
  branches(@Query() query: CatalogQueryDto) { return this.catalog.branches(query); }
  @Get('branches/:id/rooms') @ApiResponse({ status: 200, type: PublicRoomListDto })
  rooms(@Param('id', ParseUUIDPipe) id: string, @Query() query: CatalogQueryDto) { return this.catalog.rooms(id, query); }
  @Get('branches/:id/availability') @ApiResponse({ status: 200, type: PublicAvailabilityResponseDto })
  availability(@Param('id', ParseUUIDPipe) id: string, @Query() query: AvailabilitySearchDto) { return this.catalog.availability(id, query); }
  @Post('rooms/:id/quote') @ApiResponse({ status: 201, type: PublicQuoteResponseDto })
  quote(@Param('id', ParseUUIDPipe) id: string, @Body() dto: QuoteRequestDto) { return this.catalog.quote(id, dto); }
  @Get('branches/:id/booking-terms') @ApiResponse({ status: 200, type: PublicBookingTermsResponseDto })
  terms(@Param('id', ParseUUIDPipe) id: string) { return this.catalog.publicTerms(id); }
}

@ApiTags('merchant catalog') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant/catalog/publication')
export class CatalogPublicationController {
  constructor(private readonly catalog: CatalogService) {}
  @Get() @RequireRoles('OWNER') @ApiResponse({ status: 200, type: PublicationResponseDto })
  get(@Req() req: AuthenticatedRequest) { return this.catalog.getPublication(req.actor); }
  @Patch() @RequireRoles('OWNER') @ApiResponse({ status: 200, type: PublicationResponseDto })
  update(@Req() req: AuthenticatedRequest, @Body() dto: UpdatePublicationDto) { return this.catalog.setPublication(req.actor, dto.published); }
}

@ApiTags('merchant catalog') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant/catalog/public-booking-terms')
export class PublicBookingTermsController {
  constructor(private readonly catalog: CatalogService) {}
  @Get() @RequireRoles('OWNER') @ApiResponse({ status: 200, type: PublicBookingTermsResponseDto })
  get(@Req() req: AuthenticatedRequest) { return this.catalog.getTerms(req.actor); }
  @Patch() @RequireRoles('OWNER') @ApiResponse({ status: 200, type: PublicBookingTermsResponseDto })
  update(@Req() req: AuthenticatedRequest, @Body() dto: UpdatePublicBookingTermsDto) { return this.catalog.setTerms(req.actor, dto.terms); }
}
