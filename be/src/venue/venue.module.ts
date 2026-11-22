import { Module } from '@nestjs/common';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { AuthModule } from '../platform/auth/auth.module';
import { VenueController } from './venue.controller';
import { VenueService } from './venue.service';

@Module({ imports: [AuthModule], controllers: [VenueController], providers: [VenueService, TenantGuard] })
export class VenueModule {}
