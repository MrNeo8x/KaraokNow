import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards, BadRequestException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { UPLOAD_LIMITS, type UploadedFileLike } from '../platform/storage/uploaded-file';
import { BranchResponseDto, ResolvedLocationDto, RoomAmenityResponseDto, RoomMediaResponseDto, RoomResponseDto, UploadRoomMediaDto } from './venue-response.dto';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import {
  BranchStatusDto, CreateBranchDto, CreateRoomAmenityDto, CreateRoomDto, CreateRoomMediaDto, ResolveLocationDto,
  RoomStatusDto, UpdateBranchDto, UpdateRoomAmenityDto, UpdateRoomDto, UpdateRoomMediaDto
} from './dto';
import { VenueService } from './venue.service';

@ApiTags('merchant venues') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant')
export class VenueController {
  constructor(private readonly venues: VenueService) {}
  @Post('branches') @RequireRoles('OWNER')
  @ApiResponse({ status: 201, type: BranchResponseDto })
  createBranch(@Req() req: AuthenticatedRequest, @Body() dto: CreateBranchDto) { return this.venues.createBranch(req.actor, dto); }
  @Post('branch-location/resolve') @HttpCode(200) @RequireRoles('OWNER','BRANCH_MANAGER')
  @ApiResponse({ status: 200, type: ResolvedLocationDto, description: 'Preview the coordinates of a Google Maps link before saving (PD-042)' })
  @ApiResponse({ status: 422, description: 'Not a Google Maps link, or the link has no coordinates' })
  resolveLocation(@Body() dto: ResolveLocationDto) { return this.venues.resolveLocation(dto.mapsLink); }
  @Get('branches') @RequireRoles('OWNER','BRANCH_MANAGER','RECEPTIONIST','CASHIER')
  @ApiResponse({ status: 200, type: [BranchResponseDto] })
  listBranches(@Req() req: AuthenticatedRequest) { return this.venues.listBranches(req.actor); }
  @Get('branches/:id') @RequireRoles('OWNER','BRANCH_MANAGER','RECEPTIONIST','CASHIER')
  @ApiResponse({ status: 200, type: BranchResponseDto })
  getBranch(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.venues.getBranch(req.actor, id); }
  @Patch('branches/:id') @RequireRoles('OWNER','BRANCH_MANAGER')
  @ApiResponse({ status: 200, type: BranchResponseDto })
  updateBranch(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto) {
    return this.venues.updateBranch(req.actor, id, dto);
  }
  @Patch('branches/:id/status') @RequireRoles('OWNER','BRANCH_MANAGER')
  @ApiResponse({ status: 200, type: BranchResponseDto })
  setBranchStatus(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BranchStatusDto) {
    return this.venues.setBranchStatus(req.actor, id, dto);
  }
  @Post('rooms') @RequireRoles('OWNER','BRANCH_MANAGER')
  @ApiResponse({ status: 201, type: RoomResponseDto })
  createRoom(@Req() req: AuthenticatedRequest, @Body() dto: CreateRoomDto) { return this.venues.createRoom(req.actor, dto); }
  @Get('branches/:branchId/rooms') @RequireRoles('OWNER','BRANCH_MANAGER','RECEPTIONIST','CASHIER')
  @ApiResponse({ status: 200, type: [RoomResponseDto] })
  listRooms(@Req() req: AuthenticatedRequest, @Param('branchId', ParseUUIDPipe) branchId: string) {
    return this.venues.listRooms(req.actor, branchId);
  }
  @Get('rooms/:id') @RequireRoles('OWNER','BRANCH_MANAGER','RECEPTIONIST','CASHIER')
  @ApiResponse({ status: 200, type: RoomResponseDto })
  getRoom(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.venues.getRoom(req.actor, id); }
  @Patch('rooms/:id') @RequireRoles('OWNER','BRANCH_MANAGER')
  @ApiResponse({ status: 200, type: RoomResponseDto })
  updateRoom(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoomDto) {
    return this.venues.updateRoom(req.actor, id, dto);
  }
  @Patch('rooms/:id/status') @RequireRoles('OWNER','BRANCH_MANAGER')
  @ApiResponse({ status: 200, type: RoomResponseDto })
  setRoomStatus(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RoomStatusDto) {
    return this.venues.setRoomStatus(req.actor, id, dto);
  }
  @Get('rooms/:id/amenities') @RequireRoles('OWNER','BRANCH_MANAGER','RECEPTIONIST','CASHIER')
  @ApiResponse({ status: 200, type: [RoomAmenityResponseDto] })
  listRoomAmenities(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.venues.listRoomAmenities(req.actor, id);
  }
  @Post('rooms/:id/amenities') @RequireRoles('OWNER','BRANCH_MANAGER')
  @ApiResponse({ status: 201, type: RoomAmenityResponseDto })
  createRoomAmenity(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateRoomAmenityDto) {
    return this.venues.createRoomAmenity(req.actor, id, dto);
  }
  @Patch('rooms/:id/amenities/:amenityId') @RequireRoles('OWNER','BRANCH_MANAGER')
  @ApiResponse({ status: 200, type: RoomAmenityResponseDto })
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
  @ApiResponse({ status: 200, type: [RoomMediaResponseDto] })
  listRoomMedia(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.venues.listRoomMedia(req.actor, id);
  }
  @Post('rooms/:id/media') @RequireRoles('OWNER','BRANCH_MANAGER')
  @ApiResponse({ status: 201, type: RoomMediaResponseDto })
  createRoomMedia(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateRoomMediaDto) {
    return this.venues.createRoomMedia(req.actor, id, dto);
  }
  @Post('rooms/:id/media/upload') @RequireRoles('OWNER','BRANCH_MANAGER')
  @UseInterceptors(FileInterceptor('file', UPLOAD_LIMITS)) @ApiConsumes('multipart/form-data') @ApiBody({ type: UploadRoomMediaDto })
  @ApiResponse({ status: 201, type: RoomMediaResponseDto, description: 'Photo stored in the public Blob store and added to the room (PD-037)' })
  @ApiResponse({ status: 409, description: 'Room already has 10 media entries' })
  @ApiResponse({ status: 413, description: 'File larger than 4 MB' })
  @ApiResponse({ status: 422, description: 'Not a JPEG, PNG or WebP image' })
  uploadRoomMedia(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: UploadedFileLike | undefined,
                  @Body() body: { altText?: string; displayOrder?: string }) {
    const order = body?.displayOrder === undefined || body.displayOrder === '' ? undefined : Number(body.displayOrder);
    if (order !== undefined && (!Number.isInteger(order) || order < 0 || order > 10000)) throw new BadRequestException('displayOrder must be an integer between 0 and 10000');
    if (body?.altText !== undefined && String(body.altText).length > 200) throw new BadRequestException('altText must be at most 200 characters');
    return this.venues.uploadRoomMedia(req.actor, id, file, body?.altText, order);
  }
  @Patch('rooms/:id/media/:mediaId') @RequireRoles('OWNER','BRANCH_MANAGER')
  @ApiResponse({ status: 200, type: RoomMediaResponseDto })
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
