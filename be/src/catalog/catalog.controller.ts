import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { CatalogQueryDto, PublicationResponseDto, PublicBranchListDto, PublicRoomListDto, UpdatePublicationDto } from './catalog.dto';
import { CatalogService } from './catalog.service';

@ApiTags('public catalog') @Controller('public')
export class PublicCatalogController {
  constructor(private readonly catalog: CatalogService) {}
  @Get('branches') @ApiResponse({ status: 200, type: PublicBranchListDto })
  branches(@Query() query: CatalogQueryDto) { return this.catalog.branches(query); }
  @Get('branches/:id/rooms') @ApiResponse({ status: 200, type: PublicRoomListDto })
  rooms(@Param('id', ParseUUIDPipe) id: string, @Query() query: CatalogQueryDto) { return this.catalog.rooms(id, query); }
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
