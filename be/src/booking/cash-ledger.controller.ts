import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import {
  AddSurchargeDto, BookingAccountDto, CashReportDto, CashReportQueryDto, CreateReversalDto, DepositResolutionDto, PageQueryDto,
  ResolveDepositDto, ReversalResponseDto, SurchargeResponseDto, UnresolvedDepositListDto
} from './cash-ledger.dto';
import { CashLedgerService } from './cash-ledger.service';

/** PAY-007 / PD-036 manual cash reconciliation. */
@ApiTags('cash reconciliation') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant')
export class CashLedgerController {
  constructor(private readonly ledger: CashLedgerService) {}

  @ApiResponse({ status: 200, type: BookingAccountDto, description: 'Amount due vs paid with every money entry for the booking' })
  @Get('booking/bookings/:id/account') @RequireRoles('OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST', 'CASHIER')
  account(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.ledger.account(req.actor, id); }

  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Visible ASCII 1–100 characters; scoped to tenant and user' })
  @ApiResponse({ status: 200, type: SurchargeResponseDto, description: 'Recorded surcharge or matching replay' })
  @ApiResponse({ status: 409, description: 'Booking is cancelled/no-show, or idempotency key reused with a different body' })
  @Post('booking/bookings/:id/surcharges') @HttpCode(200) @RequireRoles('OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST', 'CASHIER')
  addSurcharge(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Headers('idempotency-key') key: string, @Body() dto: AddSurchargeDto) {
    return this.ledger.addSurcharge(req.actor, id, key, dto);
  }

  @ApiResponse({ status: 200, type: ReversalResponseDto, description: 'Full reversal of a deposit, CASH payment or surcharge; replay with the same reason returns it' })
  @ApiResponse({ status: 409, description: 'Entry already reversed with another reason, or expired-hold deposit already resolved' })
  @Post('booking/money-reversals') @HttpCode(200) @RequireRoles('OWNER', 'BRANCH_MANAGER')
  reverse(@Req() req: AuthenticatedRequest, @Body() dto: CreateReversalDto) { return this.ledger.reverse(req.actor, dto); }

  @ApiResponse({ status: 200, type: UnresolvedDepositListDto, description: 'Expired holds that still have a net deposit and no resolution' })
  @Get('branches/:branchId/booking/unresolved-deposits') @RequireRoles('OWNER', 'BRANCH_MANAGER', 'CASHIER')
  unresolved(@Req() req: AuthenticatedRequest, @Param('branchId', ParseUUIDPipe) branchId: string, @Query() query: PageQueryDto) {
    return this.ledger.unresolvedDeposits(req.actor, branchId, query);
  }

  @ApiResponse({ status: 200, type: DepositResolutionDto, description: 'Recorded refund/retention for an expired hold deposit, or matching replay' })
  @ApiResponse({ status: 409, description: 'Hold active or confirmed, no deposit, refund above net deposit, or a different resolution exists' })
  @Post('booking/holds/:id/deposit-resolution') @HttpCode(200) @RequireRoles('OWNER', 'BRANCH_MANAGER')
  resolve(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveDepositDto) {
    return this.ledger.resolveDeposit(req.actor, id, dto);
  }

  @ApiResponse({ status: 200, type: CashReportDto, description: 'Cash totals for one local day in the branch timezone, overall and per recorder' })
  @Get('branches/:branchId/cash-report') @RequireRoles('OWNER', 'BRANCH_MANAGER', 'CASHIER')
  report(@Req() req: AuthenticatedRequest, @Param('branchId', ParseUUIDPipe) branchId: string, @Query() query: CashReportQueryDto) {
    return this.ledger.dailyReport(req.actor, branchId, query.date);
  }
}
