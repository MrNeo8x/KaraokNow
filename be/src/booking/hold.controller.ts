import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { AttachHoldDetailsDto, CreateHoldDto, ListHoldsDto } from './hold.dto';
import { HoldService } from './hold.service';

export class HoldResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty({ format: 'uuid' }) roomId!: string;
  @ApiProperty() channel!: string;
  @ApiProperty({ format: 'date-time' }) startAt!: string;
  @ApiProperty() durationMinutes!: number;
  @ApiProperty() bufferMinutes!: number;
  @ApiProperty({ format: 'date-time' }) reservedEndAt!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ enum: ['HELD', 'EXPIRED'] }) status!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Only present in individual hold responses' }) customerPhone?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Only present in individual hold responses' }) customerEmail?: string | null;
  @ApiPropertyOptional({ nullable: true, type: 'object', additionalProperties: true, description: 'Immutable server-calculated quote snapshot, only present in individual hold responses' }) priceSnapshot?: object | null;
}

class HoldListResponseDto {
  @ApiProperty({ type: [HoldResponseDto] }) items!: HoldResponseDto[];
  @ApiProperty() limit!: number;
  @ApiProperty() offset!: number;
  @ApiProperty() hasMore!: boolean;
}

@ApiTags('booking holds') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant/booking/holds')
export class HoldController {
  constructor(private readonly holds: HoldService) {}
  @Get(':id') @RequireRoles('OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST')
  @ApiResponse({ status: 200, type: HoldResponseDto, description: 'Current hold status; an overdue hold is expired before returning' })
  get(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.holds.get(req.actor, id); }
  @Post(':id/details') @HttpCode(200) @RequireRoles('OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST')
  @ApiResponse({ status: 200, type: HoldResponseDto, description: 'Customer contact and server-calculated price snapshot recorded or replayed' })
  @ApiResponse({ status: 409, description: 'Expired hold, conflicting existing details or concurrent change' })
  @ApiResponse({ status: 422, description: 'No price rule matches or current duration policy rejects the hold' })
  attachDetails(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AttachHoldDetailsDto) {
    return this.holds.attachDetails(req.actor, id, dto);
  }
  @Post() @RequireRoles('OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Visible ASCII, 1–100 characters; scoped to tenant and user' })
  @ApiResponse({ status: 201, type: HoldResponseDto, description: 'Created hold or current state of an idempotent replay' })
  @ApiResponse({ status: 409, description: 'Occupancy conflict or idempotency key reused with different input' })
  create(@Req() req: AuthenticatedRequest, @Headers('idempotency-key') key: string, @Body() dto: CreateHoldDto) {
    return this.holds.create(req.actor, key, dto);
  }
}

@ApiTags('booking holds') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant/branches')
export class BranchHoldController {
  constructor(private readonly holds: HoldService) {}
  @Get(':branchId/booking/holds') @RequireRoles('OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST')
  @ApiResponse({ status: 200, type: HoldListResponseDto, description: 'Holds whose booking intervals overlap [from,to); overdue holds are reported as EXPIRED without releasing occupancy' })
  list(@Req() req: AuthenticatedRequest, @Param('branchId', ParseUUIDPipe) branchId: string, @Query() query: ListHoldsDto) {
    return this.holds.list(req.actor, branchId, query);
  }
}
