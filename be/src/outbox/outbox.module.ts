import { Module } from '@nestjs/common';
import { NOTIFICATION_ADAPTER } from '../notification/notification.port';
import { UnconfiguredNotificationAdapter } from '../notification/unconfigured-notification.adapter';
import { OutboxService } from './outbox.service';
import { OutboxWorker } from './outbox.worker';

@Module({
  providers: [OutboxService, OutboxWorker, UnconfiguredNotificationAdapter,
    { provide: NOTIFICATION_ADAPTER, useExisting: UnconfiguredNotificationAdapter }],
  exports: [OutboxService, OutboxWorker, NOTIFICATION_ADAPTER]
})
export class OutboxModule {}
