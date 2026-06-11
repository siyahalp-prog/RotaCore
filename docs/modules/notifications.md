# Rota Notifications

Centralized notification service for all Rota products.

## Types and channels

- Types: `system`, `security`, `forum`, `scholarship`, `admin`, `product`
- Channels: `in_app`, `email`, `webhook` (webhook is a future integration point)

## Database schema (`packages/db`)

- `notifications (id, user_id, type, channel, title, body, data, read, created_at)`
- `notification_preferences (user_id, channel, type, enabled)`
- `notification_templates (id, type, channel, subject, body_template)`
- `notification_deliveries (id, notification_id, channel, status, correlation_id, sent_at)`

## Service API

```ts
import {
  NotificationService,
  InMemoryNotificationStore,
  ConsoleEmailProvider,
} from '@rota-core/notifications';

const service = new NotificationService(new InMemoryNotificationStore(), {
  emailProvider: new ConsoleEmailProvider(logger), // SMTP placeholder available
  resolveEmail: async (userId) => lookupEmail(userId),
});

await service.createNotification({
  userId: 'user-1',
  type: 'scholarship',
  channels: ['in_app', 'email'],
  title: 'New scholarship match',
  body: 'A scholarship matching your profile was published.',
});

await service.markAsRead(notificationId, 'user-1');
await service.markAllAsRead('user-1');
const unread = await service.getUnreadCount('user-1');
```

- **Templates:** register per type+channel (`{{variable}}` placeholders); when a
  template exists, `templateVariables` are rendered instead of raw title/body.
- **Preferences:** `setPreference(userId, channel, type, enabled)` — disabled
  combinations are skipped at creation time.
- **Providers:** `ConsoleEmailProvider` (dev), `SmtpEmailProvider` (placeholder,
  throws `NOT_IMPLEMENTED` until a real SMTP client is wired).

## Event integration

`registerNotificationEventHandlers(consumer, service)` wires:

| Event                   | Notification                       |
| ----------------------- | ---------------------------------- |
| `user.registered`       | welcome (in-app + email, `system`) |
| `user.password_changed` | security alert (in-app + email)    |
| `post.comment.created`  | forum notification (in-app)        |

## Security notes

- The logger redacts secret-looking keys; email bodies are only previewed in dev logs.
- Delivery rows carry `correlation_id` for tracing without exposing payloads.
- User preferences are enforced centrally, not left to callers.
