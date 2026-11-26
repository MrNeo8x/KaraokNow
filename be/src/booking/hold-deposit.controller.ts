import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { HoldDepositEntryDto, HoldDepositStatusDto, RecordHoldDepositDto } from './hold-deposit.dto';
import { HoldDepositService } from './hold-deposit.service';

@ApiTags('hold deposits') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant/booking/holds/:id/deposits')
export class HoldDepositController {
  constructor(private readonly deposits: HoldDepositService) {}

  @Get() @RequireRoles('OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST', 'CASHIER')
  @ApiResponse({ status: 200, type: HoldDepositStatusDto, description: 'Snapshotted deposit requirement, recorded CASH entries and remaining amount' })
  status(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.deposits.status(req.actor, id);
  }

  @Post() @HttpCode(200) @RequireRoles('OWNER', 'BRANCH_MANAGER', 'CASHIER')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Visible ASCII 1–100 characters; scoped to tenant and user' })
  @ApiResponse({ status: 200, type: HoldDepositEntryDto, description: 'Recorded deposit or matching replay' })
  @ApiResponse({ status: 409, description: 'Hold inactive, no snapshot, no deposit required, amount above remaining, or idempotency conflict' })
  record(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Headers('idempotency-key') key: string, @Body() dto: RecordHoldDepositDto) {
    return this.deposits.record(req.actor, id, key, dto);
  }
}
