import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { PlatformAdminGuard } from '../listing-approval/platform-admin.guard';
import { MerchantDocumentController, MerchantDocumentService, PlatformMerchantDocumentController } from './merchant-documents';

@Module({
  imports: [AuthModule],
  controllers: [MerchantDocumentController, PlatformMerchantDocumentController],
  providers: [MerchantDocumentService, TenantGuard, PlatformAdminGuard]
})
export class MerchantDocumentsModule {}
