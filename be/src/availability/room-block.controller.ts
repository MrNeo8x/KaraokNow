import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { CreateRoomBlockDto, UpdateRoomBlockDto } from './room-block.dto';
import { AvailabilitySearchDto } from './availability-search.dto';
import { AvailabilitySearchService } from './availability-search.service';
import { RoomBlockService } from './room-block.service';

@ApiTags('availability') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant')
export class RoomBlockController {
  constructor(private readonly blocks: RoomBlockService, private readonly searchService: AvailabilitySearchService) {}
  @Get('branches/:branchId/availability') @RequireRoles('OWNER','BRANCH_MANAGER','RECEPTIONIST','CASHIER')
  search(@Req() req: AuthenticatedRequest, @Param('branchId', ParseUUIDPipe) branchId: string,
         @Query() query: AvailabilitySearchDto) {
    return this.searchService.search(req.actor, branchId, query);
  }
  @Post('room-blocks') @RequireRoles('OWNER','BRANCH_MANAGER')
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateRoomBlockDto) { return this.blocks.create(req.actor, dto); }
  @Get('branches/:branchId/room-blocks') @RequireRoles('OWNER','BRANCH_MANAGER','RECEPTIONIST','CASHIER')
  list(@Req() req: AuthenticatedRequest, @Param('branchId', ParseUUIDPipe) branchId: string) {
    return this.blocks.list(req.actor, branchId);
  }
  @Get('room-blocks/:id') @RequireRoles('OWNER','BRANCH_MANAGER','RECEPTIONIST','CASHIER')
  get(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.blocks.get(req.actor, id); }
  @Patch('room-blocks/:id') @RequireRoles('OWNER','BRANCH_MANAGER')
  update(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoomBlockDto) {
    return this.blocks.update(req.actor, id, dto);
  }
  @Post('room-blocks/:id/release') @HttpCode(HttpStatus.OK) @RequireRoles('OWNER','BRANCH_MANAGER')
  release(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.blocks.release(req.actor, id); }
}
