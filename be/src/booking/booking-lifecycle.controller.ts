import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { BookingLifecycleService } from './booking-lifecycle.service';
import { BookingResponseDto, RecordBookingOutcomeDto } from './confirmation.dto';

@ApiTags('bookings') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant/booking/bookings/:id')
export class BookingLifecycleController {
  constructor(private readonly lifecycle: BookingLifecycleService) {}

  @Post('check-in') @HttpCode(200) @RequireRoles('OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST')
  @ApiResponse({ status: 200, type: BookingResponseDto, description: 'CONFIRMED -> CHECKED_IN, or replay when already checked in. No time window is enforced' })
  @ApiResponse({ status: 409, description: 'Booking is not CONFIRMED' })
  checkIn(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.lifecycle.checkIn(req.actor, id);
  }

  @Post('check-out') @HttpCode(200) @RequireRoles('OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST')
  @ApiResponse({ status: 200, type: BookingResponseDto, description: 'CHECKED_IN -> COMPLETED with actual end time, or replay. Early check-out shortens the reservation to actual end + cleanup buffer' })
  @ApiResponse({ status: 409, description: 'Booking is not CHECKED_IN' })
  checkOut(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.lifecycle.checkOut(req.actor, id);
  }

  @Post('outcome') @HttpCode(200) @RequireRoles('OWNER', 'BRANCH_MANAGER')
  @ApiResponse({ status: 200, type: BookingResponseDto, description: 'CONFIRMED -> CANCELLED or NO_SHOW with the staff-reviewed outcome; room is released. Same body replays' })
  @ApiResponse({ status: 409, description: 'Booking not CONFIRMED, a different outcome already recorded, or refund above recorded deposits plus payments' })
  recordOutcome(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordBookingOutcomeDto) {
    return this.lifecycle.recordOutcome(req.actor, id, dto);
  }
}
