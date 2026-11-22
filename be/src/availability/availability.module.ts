import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { RoomBlockController } from './room-block.controller';
import { RoomBlockService } from './room-block.service';
import { AvailabilityPolicyController } from './availability-policy.controller';
import { AvailabilityPolicyService } from './availability-policy.service';
import { AvailabilitySearchService } from './availability-search.service';

@Module({ imports: [AuthModule], controllers: [RoomBlockController, AvailabilityPolicyController],
  providers: [RoomBlockService, AvailabilityPolicyService, AvailabilitySearchService, TenantGuard] })
export class AvailabilityModule {}
