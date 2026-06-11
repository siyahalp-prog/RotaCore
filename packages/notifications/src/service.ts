import { ValidationError, newId, systemClock, type Clock } from '@rota-core/core';
import { noopLogger, type Logger } from '@rota-core/logger';
import type { NotificationStore } from './store.js';
import type { EmailProvider } from './providers.js';
import { renderTemplate } from './templates.js';
import type {
  CreateNotificationInput,
  Notification,
  NotificationChannel,
  NotificationDelivery,
} from './types.js';

export type NotificationServiceOptions = {
  emailProvider?: EmailProvider;
  clock?: Clock;
  logger?: Logger;
  /** Resolves a user's email address for email deliveries. */
  resolveEmail?: (userId: string) => Promise<string | null>;
};

export class NotificationService {
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly emailProvider: EmailProvider | undefined;
  private readonly resolveEmail: ((userId: string) => Promise<string | null>) | undefined;

  constructor(
    private readonly store: NotificationStore,
    options: NotificationServiceOptions = {},
  ) {
    this.clock = options.clock ?? systemClock;
    this.logger = options.logger ?? noopLogger;
    this.emailProvider = options.emailProvider;
    this.resolveEmail = options.resolveEmail;
  }

  /**
   * Create a notification for each requested channel.
   * Respects user preferences: disabled channel+type combinations are skipped.
   * Uses the registered template for type+channel when available.
   */
  async createNotification(input: CreateNotificationInput): Promise<Notification[]> {
    if (input.channels.length === 0) {
      throw new ValidationError('At least one channel is required');
    }

    const created: Notification[] = [];
    for (const channel of input.channels) {
      const preference = await this.store.getPreference(input.userId, channel, input.type);
      if (preference !== null && !preference.enabled) {
        this.logger.debug('Notification skipped by user preference', {
          userId: input.userId,
          channel,
          type: input.type,
        });
        continue;
      }

      const template = await this.store.getTemplate(input.type, channel);
      const title =
        template !== null ? renderTemplate(template.subject, input.templateVariables) : input.title;
      const body =
        template !== null
          ? renderTemplate(template.bodyTemplate, input.templateVariables)
          : input.body;
      if (title === undefined || body === undefined) {
        throw new ValidationError(
          'title and body are required when no template exists for type+channel',
          { type: input.type, channel },
        );
      }

      const notification: Notification = {
        id: newId(),
        userId: input.userId,
        type: input.type,
        channel,
        title,
        body,
        data: input.data,
        read: false,
        createdAt: this.clock.now(),
      };
      await this.store.insertNotification(notification);

      const delivery: NotificationDelivery = {
        id: newId(),
        notificationId: notification.id,
        channel,
        status: 'pending',
        correlationId: input.correlationId,
      };
      await this.store.insertDelivery(delivery);

      await this.deliver(notification, delivery);
      created.push(notification);
    }
    return created;
  }

  private async deliver(notification: Notification, delivery: NotificationDelivery): Promise<void> {
    try {
      if (notification.channel === 'in_app') {
        // In-app notifications are "delivered" the moment they are stored.
        await this.store.updateDeliveryStatus(delivery.id, 'sent', this.clock.now());
        return;
      }
      if (notification.channel === 'email') {
        if (this.emailProvider === undefined || this.resolveEmail === undefined) {
          await this.store.updateDeliveryStatus(delivery.id, 'skipped');
          return;
        }
        const email = await this.resolveEmail(notification.userId);
        if (email === null) {
          await this.store.updateDeliveryStatus(delivery.id, 'skipped');
          return;
        }
        await this.emailProvider.sendEmail({
          to: email,
          subject: notification.title,
          body: notification.body,
          correlationId: delivery.correlationId,
        });
        await this.store.updateDeliveryStatus(delivery.id, 'sent', this.clock.now());
        return;
      }
      // webhook channel: future integration point
      await this.store.updateDeliveryStatus(delivery.id, 'skipped');
    } catch (error) {
      await this.store.updateDeliveryStatus(delivery.id, 'failed');
      this.logger.error('Notification delivery failed', {
        notificationId: notification.id,
        channel: notification.channel,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async sendInAppNotification(
    input: Omit<CreateNotificationInput, 'channels'>,
  ): Promise<Notification[]> {
    return this.createNotification({ ...input, channels: ['in_app'] });
  }

  async sendEmailNotification(
    input: Omit<CreateNotificationInput, 'channels'>,
  ): Promise<Notification[]> {
    return this.createNotification({ ...input, channels: ['email'] });
  }

  async markAsRead(notificationId: string, userId: string): Promise<boolean> {
    return this.store.markAsRead(notificationId, userId);
  }

  async markAllAsRead(userId: string): Promise<number> {
    return this.store.markAllAsRead(userId);
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.store.getUnreadCount(userId);
  }

  async listForUser(
    userId: string,
    options?: { unreadOnly?: boolean; limit?: number },
  ): Promise<Notification[]> {
    return this.store.listForUser(userId, options);
  }

  async setPreference(
    userId: string,
    channel: NotificationChannel,
    type: CreateNotificationInput['type'],
    enabled: boolean,
  ): Promise<void> {
    await this.store.setPreference({ userId, channel, type, enabled });
  }
}
