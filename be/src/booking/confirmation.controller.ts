import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { BookingListResponseDto, BookingResponseDto, ConfirmHoldDto } from './confirmation.dto';
import { ListHoldsDto } from './hold.dto';
import { ConfirmationService } from './confirmation.service';

@ApiTags('bookings') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant/booking/holds')
export class ConfirmationController {
  constructor(private readonly service: ConfirmationService) {}
  @Post(':id/confirm') @HttpCode(200) @RequireRoles('OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST')
  @ApiResponse({ status: 200, type: BookingResponseDto, description: 'Confirmed booking (no-deposit, or deposit fully recorded on the hold) or replay with the same terms' })
  @ApiResponse({ status: 409, description: 'Expired or incomplete hold, no-deposit not enabled, required deposit not fully recorded, or conflicting replay' })
  confirm(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmHoldDto) {
    return this.service.confirm(req.actor, id, dto);
  }
}

@ApiTags('bookings') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant/booking/bookings')
export class BookingReadController {
  constructor(private readonly service: ConfirmationService) {}
  @Get(':id') @RequireRoles('OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST', 'CASHIER')
  @ApiResponse({ status: 200, type: BookingResponseDto })
  get(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.get(req.actor, id); }
}

@ApiTags('bookings') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant/branches')
export class BranchBookingController {
  constructor(private readonly service: ConfirmationService) {}
  @Get(':branchId/booking/bookings') @RequireRoles('OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST', 'CASHIER')
  @ApiResponse({ status: 200, type: BookingListResponseDto, description: 'Bookings whose scheduled intervals overlap [from,to), excluding the cleanup buffer' })
  list(@Req() req: AuthenticatedRequest, @Param('branchId', ParseUUIDPipe) branchId: string, @Query() query: ListHoldsDto) {
    return this.service.list(req.actor, branchId, query);
  }
}
