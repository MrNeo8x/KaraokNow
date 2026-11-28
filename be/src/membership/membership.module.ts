import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { MembershipController } from './membership.controller';
import { MembershipService } from './membership.service';
import { MerchantMeController } from './merchant-me.controller';
import { MyTenantsController } from './my-tenants.controller';

@Module({ imports: [AuthModule], controllers: [MembershipController, MerchantMeController, MyTenantsController], providers: [MembershipService, TenantGuard] })
export class MembershipModule {}
