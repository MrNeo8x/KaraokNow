import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { QuoteRequestDto, UpdateBookingDurationPolicyDto } from './pricing.dto';
import { PricingService } from './pricing.service';
import { PricePlanService } from './price-plan.service';
import { CreatePricePlanDto, UpdatePricePlanDto } from './price-plan.dto';
import { SpecialDateService } from './special-date.service';
import { CreateSpecialDateDto, UpdateSpecialDateDto } from './special-date.dto';
import { PriceRuleService } from './price-rule.service';
import { CreatePriceRuleDto, UpdatePriceRuleDto } from './price-rule.dto';
import { BookingDurationPolicyResponseDto, QuoteResponseDto } from './quote-response.dto';

@ApiTags('pricing') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant')
export class PricingController {
  constructor(private readonly pricing: PricingService, private readonly plans: PricePlanService,
              private readonly specialDates: SpecialDateService, private readonly rules: PriceRuleService) {}

  @Get('pricing/plans/:id/rules') @RequireRoles('OWNER')
  listRules(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.rules.list(req.actor, id); }
  @Get('pricing/rules/:id') @RequireRoles('OWNER')
  getRule(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.rules.get(req.actor, id); }
  @Post('pricing/rules') @RequireRoles('OWNER')
  createRule(@Req() req: AuthenticatedRequest, @Body() dto: CreatePriceRuleDto) { return this.rules.create(req.actor, dto); }
  @Patch('pricing/rules/:id') @RequireRoles('OWNER')
  updateRule(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePriceRuleDto) {
    return this.rules.update(req.actor, id, dto);
  }

  @Get('pricing/special-dates') @RequireRoles('OWNER')
  listSpecialDates(@Req() req: AuthenticatedRequest) { return this.specialDates.list(req.actor); }
  @Get('pricing/special-dates/:id') @RequireRoles('OWNER')
  getSpecialDate(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.specialDates.get(req.actor, id); }
  @Post('pricing/special-dates') @RequireRoles('OWNER')
  createSpecialDate(@Req() req: AuthenticatedRequest, @Body() dto: CreateSpecialDateDto) { return this.specialDates.create(req.actor, dto); }
  @Patch('pricing/special-dates/:id') @RequireRoles('OWNER')
  updateSpecialDate(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSpecialDateDto) {
    return this.specialDates.update(req.actor, id, dto);
  }

  @Get('pricing/plans') @RequireRoles('OWNER')
  listPlans(@Req() req: AuthenticatedRequest) { return this.plans.list(req.actor); }

  @Get('pricing/plans/:id') @RequireRoles('OWNER')
  getPlan(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.plans.get(req.actor, id); }

  @Post('pricing/plans') @RequireRoles('OWNER')
  createPlan(@Req() req: AuthenticatedRequest, @Body() dto: CreatePricePlanDto) { return this.plans.create(req.actor, dto); }

  @Patch('pricing/plans/:id') @RequireRoles('OWNER')
  updatePlan(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePricePlanDto) {
    return this.plans.update(req.actor, id, dto);
  }

  @Get('pricing/duration-policy') @RequireRoles('OWNER','BRANCH_MANAGER','RECEPTIONIST','CASHIER')
  @ApiResponse({ status: 200, type: BookingDurationPolicyResponseDto })
  getDurationPolicy(@Req() req: AuthenticatedRequest) { return this.pricing.getDurationPolicy(req.actor.tenantId!); }

  @Patch('pricing/duration-policy') @RequireRoles('OWNER','BRANCH_MANAGER')
  @ApiResponse({ status: 200, type: BookingDurationPolicyResponseDto })
  updateDurationPolicy(@Req() req: AuthenticatedRequest, @Body() dto: UpdateBookingDurationPolicyDto) {
    return this.pricing.updateDurationPolicy(req.actor, dto);
  }

  @Post('rooms/:roomId/quote') @RequireRoles('OWNER','BRANCH_MANAGER','RECEPTIONIST','CASHIER')
  @ApiResponse({ status: 201, type: QuoteResponseDto })
  quote(@Req() req: AuthenticatedRequest, @Param('roomId', ParseUUIDPipe) roomId: string, @Body() dto: QuoteRequestDto) {
    return this.pricing.quote(req.actor, roomId, dto);
  }

}
