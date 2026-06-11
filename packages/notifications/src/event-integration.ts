import type { EventConsumer } from '@rota-core/events';
import type { NotificationService } from './service.js';

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Wire standard Rota ecosystem events to notifications:
 * - user.registered        → welcome notification (in-app + email)
 * - user.password_changed  → security notification (in-app + email)
 * - post.comment.created   → forum notification (in-app)
 */
export function registerNotificationEventHandlers(
  consumer: EventConsumer,
  notifications: NotificationService,
): void {
  consumer.on('user.registered', async (event) => {
    const userId = event.actorId ?? asString(event.payload['userId']);
    if (userId === '') return;
    await notifications.createNotification({
      userId,
      type: 'system',
      channels: ['in_app', 'email'],
      title: 'Welcome to Rota!',
      body: 'Your account has been created. Explore RotaGlobal to get started.',
      templateVariables: { name: asString(event.payload['name'], 'there') },
      ...(event.correlationId !== undefined ? { correlationId: event.correlationId } : {}),
    });
  });

  consumer.on('user.password_changed', async (event) => {
    const userId = event.actorId ?? asString(event.payload['userId']);
    if (userId === '') return;
    await notifications.createNotification({
      userId,
      type: 'security',
      channels: ['in_app', 'email'],
      title: 'Your password was changed',
      body: 'If you did not perform this change, please reset your password immediately.',
      ...(event.correlationId !== undefined ? { correlationId: event.correlationId } : {}),
    });
  });

  consumer.on('post.comment.created', async (event) => {
    const userId = asString(event.payload['postAuthorId']);
    if (userId === '') return;
    await notifications.createNotification({
      userId,
      type: 'forum',
      channels: ['in_app'],
      title: 'New comment on your post',
      body: `${asString(event.payload['commentAuthorName'], 'Someone')} commented on your post.`,
      data: { postId: event.payload['postId'] },
      ...(event.correlationId !== undefined ? { correlationId: event.correlationId } : {}),
    });
  });
}
