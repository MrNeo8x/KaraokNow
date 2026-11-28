import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { CatalogPublicationController, PublicBookingTermsController, PublicCatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { MerchantLogoController, MerchantLogoService } from './merchant-logo';
import { AvailabilityModule } from '../availability/availability.module';
import { PricingModule } from '../pricing/pricing.module';

@Module({ imports: [AuthModule, AvailabilityModule, PricingModule], controllers: [CatalogPublicationController, PublicBookingTermsController, PublicCatalogController, MerchantLogoController], providers: [CatalogService, MerchantLogoService, TenantGuard] })
export class CatalogModule {}
