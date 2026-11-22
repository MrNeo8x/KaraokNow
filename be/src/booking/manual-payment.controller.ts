import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { ManualPaymentListDto, ManualPaymentResponseDto, RecordManualPaymentDto } from './manual-payment.dto';
import { ManualPaymentService } from './manual-payment.service';
import { PolicyListQueryDto } from './policy-list.dto';

@ApiTags('manual payments') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant/booking/bookings/:id/manual-payments')
export class ManualPaymentController {
  constructor(private readonly payments: ManualPaymentService) {}
  @Get() @RequireRoles('OWNER','BRANCH_MANAGER','CASHIER') @ApiResponse({ status: 200, type: ManualPaymentListDto })
  list(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Query() query: PolicyListQueryDto) {
    return this.payments.list(req.actor,id,query);
  }
  @Post() @HttpCode(200) @RequireRoles('OWNER','BRANCH_MANAGER','CASHIER')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Visible ASCII 1–100 characters; scoped to tenant and user' })
  @ApiResponse({ status: 200, type: ManualPaymentResponseDto, description: 'Recorded payment or matching replay' })
  @ApiResponse({ status: 409, description: 'Idempotency key reused with different payment details' })
  record(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Headers('idempotency-key') key: string, @Body() dto: RecordManualPaymentDto) {
    return this.payments.record(req.actor,id,key,dto);
  }
}
