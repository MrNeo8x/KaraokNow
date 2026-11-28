import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { MembershipModule } from '../membership/membership.module';
import { PlatformAdminGuard } from '../listing-approval/platform-admin.guard';
import { PlatformMembershipsController, PlatformUsersController } from './platform-users.controller';
import { PlatformUsersService } from './platform-users.service';

@Module({
  imports: [AuthModule, MembershipModule],
  controllers: [PlatformUsersController, PlatformMembershipsController],
  providers: [PlatformUsersService, PlatformAdminGuard]
})
export class PlatformUsersModule {}
