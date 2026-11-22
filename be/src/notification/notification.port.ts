export const NOTIFICATION_ADAPTER = Symbol('NOTIFICATION_ADAPTER');

export interface NotificationRequest {
  channel: 'EMAIL' | 'SMS' | 'ZALO';
  destinationRef: string;
  template: string;
  variables: Record<string, string>;
}

export interface NotificationAdapter {
  deliver(request: NotificationRequest): Promise<void>;
}
