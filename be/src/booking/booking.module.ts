import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { HoldTtlController } from './hold-ttl.controller';
import { HoldTtlService } from './hold-ttl.service';
import { BranchHoldController, HoldController } from './hold.controller';
import { HoldService } from './hold.service';
import { PricingModule } from '../pricing/pricing.module';

@Module({ imports: [AuthModule, PricingModule], controllers: [HoldTtlController, HoldController, BranchHoldController], providers: [HoldTtlService, HoldService, TenantGuard] })
export class BookingModule {}
