import type {
  Notification,
  NotificationChannel,
  NotificationDelivery,
  NotificationPreference,
  NotificationTemplate,
  NotificationType,
  DeliveryStatus,
} from './types.js';

/** Storage boundary for notifications. In-memory implementation provided; PostgreSQL adapter is a next step (schema lives in @rota-core/db). */
export type NotificationStore = {
  insertNotification(notification: Notification): Promise<void>;
  getNotification(id: string): Promise<Notification | null>;
  listForUser(
    userId: string,
    options?: { unreadOnly?: boolean; limit?: number },
  ): Promise<Notification[]>;
  markAsRead(id: string, userId: string): Promise<boolean>;
  markAllAsRead(userId: string): Promise<number>;
  getUnreadCount(userId: string): Promise<number>;

  getPreference(
    userId: string,
    channel: NotificationChannel,
    type: NotificationType,
  ): Promise<NotificationPreference | null>;
  setPreference(preference: NotificationPreference): Promise<void>;

  upsertTemplate(template: NotificationTemplate): Promise<void>;
  getTemplate(
    type: NotificationType,
    channel: NotificationChannel,
  ): Promise<NotificationTemplate | null>;

  insertDelivery(delivery: NotificationDelivery): Promise<void>;
  updateDeliveryStatus(id: string, status: DeliveryStatus, sentAt?: Date): Promise<void>;
  listDeliveries(notificationId: string): Promise<NotificationDelivery[]>;
};

export class InMemoryNotificationStore implements NotificationStore {
  private readonly notifications = new Map<string, Notification>();
  private readonly preferences = new Map<string, NotificationPreference>();
  private readonly templates = new Map<string, NotificationTemplate>();
  private readonly deliveries = new Map<string, NotificationDelivery>();

  private prefKey(userId: string, channel: NotificationChannel, type: NotificationType): string {
    return `${userId}:${channel}:${type}`;
  }

  async insertNotification(notification: Notification): Promise<void> {
    this.notifications.set(notification.id, { ...notification });
  }

  async getNotification(id: string): Promise<Notification | null> {
    const n = this.notifications.get(id);
    return n !== undefined ? { ...n } : null;
  }

  async listForUser(
    userId: string,
    options: { unreadOnly?: boolean; limit?: number } = {},
  ): Promise<Notification[]> {
    let results = [...this.notifications.values()].filter((n) => n.userId === userId);
    if (options.unreadOnly === true) results = results.filter((n) => !n.read);
    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return results.slice(0, options.limit ?? 50).map((n) => ({ ...n }));
  }

  async markAsRead(id: string, userId: string): Promise<boolean> {
    const n = this.notifications.get(id);
    if (n === undefined || n.userId !== userId) return false;
    n.read = true;
    return true;
  }

  async markAllAsRead(userId: string): Promise<number> {
    let count = 0;
    for (const n of this.notifications.values()) {
      if (n.userId === userId && !n.read) {
        n.read = true;
        count += 1;
      }
    }
    return count;
  }

  async getUnreadCount(userId: string): Promise<number> {
    let count = 0;
    for (const n of this.notifications.values()) {
      if (n.userId === userId && !n.read) count += 1;
    }
    return count;
  }

  async getPreference(
    userId: string,
    channel: NotificationChannel,
    type: NotificationType,
  ): Promise<NotificationPreference | null> {
    return this.preferences.get(this.prefKey(userId, channel, type)) ?? null;
  }

  async setPreference(preference: NotificationPreference): Promise<void> {
    this.preferences.set(this.prefKey(preference.userId, preference.channel, preference.type), {
      ...preference,
    });
  }

  async upsertTemplate(template: NotificationTemplate): Promise<void> {
    this.templates.set(`${template.type}:${template.channel}`, { ...template });
  }

  async getTemplate(
    type: NotificationType,
    channel: NotificationChannel,
  ): Promise<NotificationTemplate | null> {
    return this.templates.get(`${type}:${channel}`) ?? null;
  }

  async insertDelivery(delivery: NotificationDelivery): Promise<void> {
    this.deliveries.set(delivery.id, { ...delivery });
  }

  async updateDeliveryStatus(id: string, status: DeliveryStatus, sentAt?: Date): Promise<void> {
    const d = this.deliveries.get(id);
    if (d === undefined) return;
    d.status = status;
    if (sentAt !== undefined) d.sentAt = sentAt;
  }

  async listDeliveries(notificationId: string): Promise<NotificationDelivery[]> {
    return [...this.deliveries.values()]
      .filter((d) => d.notificationId === notificationId)
      .map((d) => ({ ...d }));
  }
}
