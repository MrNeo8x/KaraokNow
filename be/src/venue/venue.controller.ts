import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import {
  BranchStatusDto, CreateBranchDto, CreateRoomAmenityDto, CreateRoomDto, CreateRoomMediaDto,
  RoomStatusDto, UpdateBranchDto, UpdateRoomAmenityDto, UpdateRoomDto, UpdateRoomMediaDto
} from './dto';
import { VenueService } from './venue.service';

@ApiTags('merchant venues') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant')
export class VenueController {
  constructor(private readonly venues: VenueService) {}
  @Post('branches') @RequireRoles('OWNER')
  createBranch(@Req() req: AuthenticatedRequest, @Body() dto: CreateBranchDto) { return this.venues.createBranch(req.actor, dto); }
  @Get('branches') @RequireRoles('OWNER','BRANCH_MANAGER','RECEPTIONIST','CASHIER')
  listBranches(@Req() req: AuthenticatedRequest) { return this.venues.listBranches(req.actor); }
  @Get('branches/:id') @RequireRoles('OWNER','BRANCH_MANAGER','RECEPTIONIST','CASHIER')
  getBranch(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.venues.getBranch(req.actor, id); }
  @Patch('branches/:id') @RequireRoles('OWNER','BRANCH_MANAGER')
  updateBranch(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto) {
    return this.venues.updateBranch(req.actor, id, dto);
  }
  @Patch('branches/:id/status') @RequireRoles('OWNER','BRANCH_MANAGER')
  setBranchStatus(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BranchStatusDto) {
    return this.venues.setBranchStatus(req.actor, id, dto);
  }
  @Post('rooms') @RequireRoles('OWNER','BRANCH_MANAGER')
  createRoom(@Req() req: AuthenticatedRequest, @Body() dto: CreateRoomDto) { return this.venues.createRoom(req.actor, dto); }
  @Get('branches/:branchId/rooms') @RequireRoles('OWNER','BRANCH_MANAGER','RECEPTIONIST','CASHIER')
  listRooms(@Req() req: AuthenticatedRequest, @Param('branchId', ParseUUIDPipe) branchId: string) {
    return this.venues.listRooms(req.actor, branchId);
  }
  @Get('rooms/:id') @RequireRoles('OWNER','BRANCH_MANAGER','RECEPTIONIST','CASHIER')
  getRoom(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.venues.getRoom(req.actor, id); }
  @Patch('rooms/:id') @RequireRoles('OWNER','BRANCH_MANAGER')
  updateRoom(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoomDto) {
    return this.venues.updateRoom(req.actor, id, dto);
  }
  @Patch('rooms/:id/status') @RequireRoles('OWNER','BRANCH_MANAGER')
  setRoomStatus(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RoomStatusDto) {
    return this.venues.setRoomStatus(req.actor, id, dto);
  }
  @Get('rooms/:id/amenities') @RequireRoles('OWNER','BRANCH_MANAGER','RECEPTIONIST','CASHIER')
  listRoomAmenities(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.venues.listRoomAmenities(req.actor, id);
  }
  @Post('rooms/:id/amenities') @RequireRoles('OWNER','BRANCH_MANAGER')
  createRoomAmenity(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateRoomAmenityDto) {
    return this.venues.createRoomAmenity(req.actor, id, dto);
  }
  @Patch('rooms/:id/amenities/:amenityId') @RequireRoles('OWNER','BRANCH_MANAGER')
  updateRoomAmenity(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string,
                    @Param('amenityId', ParseUUIDPipe) amenityId: string, @Body() dto: UpdateRoomAmenityDto) {
    return this.venues.updateRoomAmenity(req.actor, id, amenityId, dto);
  }
  @Delete('rooms/:id/amenities/:amenityId') @RequireRoles('OWNER','BRANCH_MANAGER') @HttpCode(HttpStatus.NO_CONTENT)
  deleteRoomAmenity(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string,
                    @Param('amenityId', ParseUUIDPipe) amenityId: string) {
    return this.venues.deleteRoomAmenity(req.actor, id, amenityId);
  }
  @Get('rooms/:id/media') @RequireRoles('OWNER','BRANCH_MANAGER','RECEPTIONIST','CASHIER')
  listRoomMedia(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.venues.listRoomMedia(req.actor, id);
  }
  @Post('rooms/:id/media') @RequireRoles('OWNER','BRANCH_MANAGER')
  createRoomMedia(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateRoomMediaDto) {
    return this.venues.createRoomMedia(req.actor, id, dto);
  }
  @Patch('rooms/:id/media/:mediaId') @RequireRoles('OWNER','BRANCH_MANAGER')
  updateRoomMedia(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string,
                  @Param('mediaId', ParseUUIDPipe) mediaId: string, @Body() dto: UpdateRoomMediaDto) {
    return this.venues.updateRoomMedia(req.actor, id, mediaId, dto);
  }
  @Delete('rooms/:id/media/:mediaId') @RequireRoles('OWNER','BRANCH_MANAGER') @HttpCode(HttpStatus.NO_CONTENT)
  deleteRoomMedia(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string,
                  @Param('mediaId', ParseUUIDPipe) mediaId: string) {
    return this.venues.deleteRoomMedia(req.actor, id, mediaId);
  }
}
