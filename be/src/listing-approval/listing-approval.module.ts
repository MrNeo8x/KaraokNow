import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { ListingApprovalController } from './listing-approval.controller';
import { ListingApprovalService } from './listing-approval.service';
import { MerchantOnboardingController } from './merchant-onboarding.controller';
import { MerchantOnboardingService } from './merchant-onboarding.service';
import { PlatformAdminGuard } from './platform-admin.guard';

@Module({
  imports: [AuthModule],
  controllers: [ListingApprovalController, MerchantOnboardingController],
  providers: [ListingApprovalService, MerchantOnboardingService, PlatformAdminGuard]
})
export class ListingApprovalModule {}
