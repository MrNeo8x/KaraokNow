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
import { DepositExemptionController, DepositExemptionService } from './deposit-exemption';
import { ManualPaymentController } from './manual-payment.controller';
import { ManualPaymentService } from './manual-payment.service';
import { PublicBookingController } from './public-booking.controller';
import { PublicBookingService } from './public-booking.service';
import { HoldDepositController } from './hold-deposit.controller';
import { HoldDepositService } from './hold-deposit.service';
import { BookingLifecycleController } from './booking-lifecycle.controller';
import { BookingLifecycleService } from './booking-lifecycle.service';
import { OvertimePolicyController, OvertimePolicyService } from './overtime-policy';
import { CashLedgerController } from './cash-ledger.controller';
import { CashLedgerService } from './cash-ledger.service';

@Module({ imports: [AuthModule, PricingModule], controllers: [HoldTtlController, HoldController, BranchHoldController, NoDepositPolicyController, DepositPolicyController, HoldExpiryStatusController, ConfirmationController, BookingReadController, BranchBookingController, ManualPaymentController, PublicBookingController, HoldDepositController, BookingLifecycleController, OvertimePolicyController, CashLedgerController, DepositExemptionController], providers: [DepositExemptionService, HoldTtlService, HoldService, NoDepositPolicyService, DepositPolicyService, ConfirmationService, ManualPaymentService, PublicBookingService, HoldDepositService, BookingLifecycleService, OvertimePolicyService, CashLedgerService, TenantGuard], exports: [HoldService] })
export class BookingModule {}
