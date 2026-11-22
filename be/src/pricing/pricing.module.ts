import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';
import { PricePlanService } from './price-plan.service';
import { SpecialDateService } from './special-date.service';
import { PriceRuleService } from './price-rule.service';

@Module({ imports: [AuthModule], controllers: [PricingController], providers: [PricingService, PricePlanService, SpecialDateService, PriceRuleService, TenantGuard], exports: [PricingService] })
export class PricingModule {}
