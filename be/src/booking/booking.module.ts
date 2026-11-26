import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { HoldTtlController } from './hold-ttl.controller';
import { HoldTtlService } from './hold-ttl.service';
import { BranchHoldController, HoldController } from './hold.controller';
import { HoldService } from './hold.service';
import { PricingModule } from '../pricing/pricing.module';
import { NoDepositPolicyController } from './no-deposit-policy.controller';
import { NoDepositPolicyService } from './no-deposit-policy.service';
import { DepositPolicyController } from './deposit-policy.controller';
import { DepositPolicyService } from './deposit-policy.service';
import { HoldExpiryStatusController } from './hold-expiry-status.controller';
import { BookingReadController, BranchBookingController, ConfirmationController } from './confirmation.controller';
import { ConfirmationService } from './confirmation.service';
import { ManualPaymentController } from './manual-payment.controller';
import { ManualPaymentService } from './manual-payment.service';
import { PublicBookingController } from './public-booking.controller';
import { PublicBookingService } from './public-booking.service';

@Module({ imports: [AuthModule, PricingModule], controllers: [HoldTtlController, HoldController, BranchHoldController, NoDepositPolicyController, DepositPolicyController, HoldExpiryStatusController, ConfirmationController, BookingReadController, BranchBookingController, ManualPaymentController, PublicBookingController], providers: [HoldTtlService, HoldService, NoDepositPolicyService, DepositPolicyService, ConfirmationService, ManualPaymentService, PublicBookingService, TenantGuard] })
export class BookingModule {}
