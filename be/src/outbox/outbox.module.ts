import { Module } from '@nestjs/common';
import { NOTIFICATION_ADAPTER } from '../notification/notification.port';
import { UnconfiguredNotificationAdapter } from '../notification/unconfigured-notification.adapter';
import { OutboxService } from './outbox.service';
import { OutboxWorker } from './outbox.worker';
import { AuthModule } from '../platform/auth/auth.module';
import { TenantGuard } from '../platform/tenant/tenant.guard';
import { OutboxStatusController } from './outbox-status.controller';

@Module({
  imports: [AuthModule],
  controllers: [OutboxStatusController],
  providers: [OutboxService, OutboxWorker, UnconfiguredNotificationAdapter, TenantGuard,
    { provide: NOTIFICATION_ADAPTER, useExisting: UnconfiguredNotificationAdapter }],
  exports: [OutboxService, OutboxWorker, NOTIFICATION_ADAPTER]
})
export class OutboxModule {}
