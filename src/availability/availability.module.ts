import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { RoomBlockController } from './room-block.controller';
import { RoomBlockService } from './room-block.service';

@Module({ imports: [AuthModule], controllers: [RoomBlockController], providers: [RoomBlockService, TenantGuard] })
export class AvailabilityModule {}
