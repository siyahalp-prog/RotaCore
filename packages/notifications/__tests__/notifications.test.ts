import { describe, expect, it } from 'vitest';
import { EventConsumer, EventPublisher, InMemoryEventStore } from '@rota-core/events';
import {
  ConsoleEmailProvider,
  InMemoryNotificationStore,
  NotificationService,
  registerNotificationEventHandlers,
  renderTemplate,
} from '../src/index.js';
import type { EmailMessage, EmailProvider } from '../src/index.js';

class CapturingEmailProvider implements EmailProvider {
  readonly name = 'capturing';
  readonly sent: EmailMessage[] = [];
  async sendEmail(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}

function setup() {
  const store = new InMemoryNotificationStore();
  const emailProvider = new CapturingEmailProvider();
  const service = new NotificationService(store, {
    emailProvider,
    resolveEmail: async (userId) => `${userId}@example.com`,
  });
  return { store, emailProvider, service };
}

describe('Rota Notifications', () => {
  it('renders templates with variables', () => {
    expect(
      renderTemplate('Hello {{name}}, welcome to {{product}}!', { name: 'Ada', product: 'Rota' }),
    ).toBe('Hello Ada, welcome to Rota!');
    expect(renderTemplate('Missing {{unknown}} variable')).toBe('Missing  variable');
  });

  it('creates in-app notifications and tracks unread state', async () => {
    const { service } = setup();
    await service.sendInAppNotification({
      userId: 'user-1',
      type: 'forum',
      title: 'New reply',
      body: 'Someone replied to your thread.',
    });

    expect(await service.getUnreadCount('user-1')).toBe(1);
    const [notification] = await service.listForUser('user-1');
    expect(notification?.title).toBe('New reply');

    await service.markAsRead(notification!.id, 'user-1');
    expect(await service.getUnreadCount('user-1')).toBe(0);
  });

  it('markAllAsRead marks every unread notification', async () => {
    const { service } = setup();
    for (let i = 0; i < 3; i++) {
      await service.sendInAppNotification({
        userId: 'user-2',
        type: 'system',
        title: `n${i}`,
        body: 'body',
      });
    }
    const updated = await service.markAllAsRead('user-2');
    expect(updated).toBe(3);
    expect(await service.getUnreadCount('user-2')).toBe(0);
  });

  it('sends email notifications through the provider abstraction', async () => {
    const { service, emailProvider } = setup();
    await service.sendEmailNotification({
      userId: 'user-3',
      type: 'security',
      title: 'Password changed',
      body: 'Your password was changed.',
    });
    expect(emailProvider.sent).toHaveLength(1);
    expect(emailProvider.sent[0]?.to).toBe('user-3@example.com');
  });

  it('respects user preferences (disabled channel+type is skipped)', async () => {
    const { service, emailProvider } = setup();
    await service.setPreference('user-4', 'email', 'product', false);

    const created = await service.createNotification({
      userId: 'user-4',
      type: 'product',
      channels: ['in_app', 'email'],
      title: 'New feature',
      body: 'Try the new dashboard.',
    });

    expect(created).toHaveLength(1);
    expect(created[0]?.channel).toBe('in_app');
    expect(emailProvider.sent).toHaveLength(0);
  });

  it('uses templates for type+channel when registered', async () => {
    const { store, service } = setup();
    await store.upsertTemplate({
      id: 'tpl-1',
      type: 'system',
      channel: 'in_app',
      subject: 'Welcome {{name}}!',
      bodyTemplate: 'Hi {{name}}, glad you joined {{product}}.',
    });

    const [notification] = await service.sendInAppNotification({
      userId: 'user-5',
      type: 'system',
      templateVariables: { name: 'Ada', product: 'RotaGlobal' },
    });

    expect(notification?.title).toBe('Welcome Ada!');
    expect(notification?.body).toBe('Hi Ada, glad you joined RotaGlobal.');
  });

  it('integrates with Rota Events (user.registered → welcome notification)', async () => {
    const { service } = setup();
    const eventStore = new InMemoryEventStore();
    const publisher = new EventPublisher(eventStore);
    const consumer = new EventConsumer(eventStore);
    registerNotificationEventHandlers(consumer, service);

    await publisher.publish({
      type: 'user.registered',
      source: 'rota-identity',
      actorId: 'user-6',
      payload: { name: 'Ada' },
    });
    await consumer.processPending();

    const notifications = await service.listForUser('user-6');
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications.some((n) => n.title.includes('Welcome'))).toBe(true);
  });

  it('console email provider does not throw', async () => {
    const provider = new ConsoleEmailProvider();
    await expect(
      provider.sendEmail({ to: 'a@b.c', subject: 's', body: 'b' }),
    ).resolves.toBeUndefined();
  });
});
