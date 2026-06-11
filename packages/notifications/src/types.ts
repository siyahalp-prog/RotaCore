export const NOTIFICATION_TYPES = [
  'system',
  'security',
  'forum',
  'scholarship',
  'admin',
  'product',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'webhook'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type Notification = {
  id: string;
  userId: string;
  type: NotificationType;
  channel: NotificationChannel;
  title: string;
  body: string;
  data?: Record<string, unknown> | undefined;
  read: boolean;
  createdAt: Date;
};

export type NotificationPreference = {
  userId: string;
  channel: NotificationChannel;
  type: NotificationType;
  enabled: boolean;
};

export type NotificationTemplate = {
  id: string;
  type: NotificationType;
  channel: NotificationChannel;
  subject: string;
  bodyTemplate: string;
};

export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export type NotificationDelivery = {
  id: string;
  notificationId: string;
  channel: NotificationChannel;
  status: DeliveryStatus;
  correlationId?: string | undefined;
  sentAt?: Date | undefined;
};

export type CreateNotificationInput = {
  userId: string;
  type: NotificationType;
  channels: NotificationChannel[];
  title?: string;
  body?: string;
  /** Variables for template rendering when a template exists for type+channel. */
  templateVariables?: Record<string, string>;
  data?: Record<string, unknown>;
  correlationId?: string;
};
