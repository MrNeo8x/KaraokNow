import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { PlatformAdminGuard } from '../listing-approval/platform-admin.guard';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { MerchantReportsController, PlatformReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [AuthModule],
  controllers: [MerchantReportsController, PlatformReportsController],
  providers: [ReportsService, TenantGuard, PlatformAdminGuard]
})
export class ReportsModule {}
