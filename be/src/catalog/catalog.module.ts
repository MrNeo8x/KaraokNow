import { Module } from '@nestjs/common';
import { AuthModule } from '../platform/auth/auth.module';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { CatalogPublicationController, PublicCatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({ imports: [AuthModule], controllers: [CatalogPublicationController, PublicCatalogController], providers: [CatalogService, TenantGuard] })
export class CatalogModule {}
