import { Injectable } from '@nestjs/common';
import type { NotificationAdapter, NotificationRequest } from './notification.port';

@Injectable()
export class UnconfiguredNotificationAdapter implements NotificationAdapter {
  async deliver(_request: NotificationRequest): Promise<void> {
    throw new Error('Notification provider is not configured');
  }
}
