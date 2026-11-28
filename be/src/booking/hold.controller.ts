import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { AttachHoldDetailsDto, CreateHoldDto, ListHoldsDto } from './hold.dto';
import { HoldService } from './hold.service';
import { PriceSnapshotDto } from '../pricing/quote-response.dto';
import { DepositPolicySnapshotDto } from './hold-deposit.dto';

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
  @ApiProperty({ enum: ['HELD', 'EXPIRED', 'CONFIRMED'] }) status!: string;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Only present in individual hold responses' }) customerPhone?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Only present in individual hold responses' }) customerEmail?: string | null;
  @ApiPropertyOptional({ nullable: true, type: PriceSnapshotDto, description: 'Immutable server-calculated quote snapshot, only present in individual hold responses' }) priceSnapshot?: PriceSnapshotDto | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time', description: 'Time staff recorded a successful verification call; individual responses only' }) phoneVerifiedAt?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'uuid', description: 'Staff user who recorded the verification call; individual responses only' }) phoneVerifiedBy?: string | null;
  @ApiPropertyOptional({ nullable: true, type: DepositPolicySnapshotDto, description: 'Deposit policy frozen with the price snapshot; individual responses only' }) depositPolicySnapshot?: DepositPolicySnapshotDto | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'WEB holds: exact public terms the customer accepted. Confirmation must send this text as cancellationTerms. Null for staff holds; individual responses only' }) publicAcceptedTerms?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Version of publicAcceptedTerms; individual responses only' }) publicAcceptedTermsVersion?: string | null;
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
  @Get(':id') @RequireRoles('OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST', 'CASHIER')
  @ApiResponse({ status: 200, type: HoldResponseDto, description: 'Current hold status; an overdue hold is expired before returning' })
  get(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.holds.get(req.actor, id); }
  @Post(':id/details') @HttpCode(200) @RequireRoles('OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST')
  @ApiResponse({ status: 200, type: HoldResponseDto, description: 'Customer contact and server-calculated price snapshot recorded or replayed' })
  @ApiResponse({ status: 409, description: 'Expired hold, conflicting existing details or concurrent change' })
  @ApiResponse({ status: 422, description: 'No price rule matches or current duration policy rejects the hold' })
  attachDetails(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AttachHoldDetailsDto) {
    return this.holds.attachDetails(req.actor, id, dto);
  }
  @Post(':id/phone-verification') @HttpCode(200) @RequireRoles('OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST')
  @ApiResponse({ status: 200, type: HoldResponseDto, description: 'Staff-recorded successful verification call, or previously recorded result' })
  @ApiResponse({ status: 409, description: 'Hold has expired or customer phone is not recorded' })
  verifyPhone(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.holds.recordPhoneVerification(req.actor, id);
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
  @Get(':branchId/booking/holds') @RequireRoles('OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST', 'CASHIER')
  @ApiResponse({ status: 200, type: HoldListResponseDto, description: 'Holds whose booking intervals overlap [from,to); overdue holds are reported as EXPIRED without releasing occupancy' })
  list(@Req() req: AuthenticatedRequest, @Param('branchId', ParseUUIDPipe) branchId: string, @Query() query: ListHoldsDto) {
    return this.holds.list(req.actor, branchId, query);
  }
}
