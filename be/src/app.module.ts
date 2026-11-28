import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/env.validation';
import { DatabaseModule } from './platform/database/database.module';
import { AuthModule } from './platform/auth/auth.module';
import { MembershipModule } from './membership/membership.module';
import { AuditModule } from './audit/audit.module';
import { VenueModule } from './venue/venue.module';
import { HttpPlatformModule } from './platform/http/http-platform.module';
import { CorrelationMiddleware } from './platform/http/correlation.middleware';
import { RequestLoggerMiddleware } from './platform/http/request-logger.middleware';
import { AvailabilityModule } from './availability/availability.module';
import { OutboxModule } from './outbox/outbox.module';
import { OperationsModule } from './operations/operations.module';
import { PricingModule } from './pricing/pricing.module';
import { BookingModule } from './booking/booking.module';
import { CatalogModule } from './catalog/catalog.module';
import { ListingApprovalModule } from './listing-approval/listing-approval.module';
import { JobsModule } from './jobs/jobs.module';
import { StorageModule } from './platform/storage/storage.module';
import { MerchantDocumentsModule } from './merchant-documents/merchant-documents.module';
import { PlatformUsersModule } from './platform-users/platform-users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment
    }),
    DatabaseModule,
    HttpPlatformModule,
    AuthModule,
    MembershipModule,
    StorageModule,
    MerchantDocumentsModule,
    PlatformUsersModule,
    VenueModule,
    AuditModule,
    AvailabilityModule,
    OutboxModule,
    OperationsModule,
    PricingModule,
    BookingModule,
    CatalogModule, ListingApprovalModule, JobsModule
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware, RequestLoggerMiddleware).forRoutes('{*splat}');
  }
}
