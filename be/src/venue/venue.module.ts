import { BranchPhotoController, MerchantPhotoController, VenuePhotoService } from './venue-photos';
import { Module } from '@nestjs/common';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { AuthModule } from '../platform/auth/auth.module';
import { VenueController } from './venue.controller';
import { VenueService } from './venue.service';

@Module({ imports: [AuthModule], controllers: [VenueController, MerchantPhotoController, BranchPhotoController], providers: [VenueService, VenuePhotoService, TenantGuard] })
export class VenueModule {}
