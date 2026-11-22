import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { MembershipController } from './membership.controller';
import { MembershipService } from './membership.service';

@Module({ imports: [AuthModule], controllers: [MembershipController], providers: [MembershipService, TenantGuard] })
export class MembershipModule {}
