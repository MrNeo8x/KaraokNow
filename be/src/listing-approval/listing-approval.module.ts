import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { ListingApprovalController } from './listing-approval.controller';
import { ListingApprovalService } from './listing-approval.service';
import { PlatformAdminGuard } from './platform-admin.guard';

@Module({ imports: [AuthModule], controllers: [ListingApprovalController], providers: [ListingApprovalService, PlatformAdminGuard] })
export class ListingApprovalModule {}
