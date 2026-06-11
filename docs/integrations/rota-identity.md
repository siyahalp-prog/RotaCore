# Integration: Rota Identity

Rota Identity is the producer of the ecosystem's most important events.

## Publishing identity events

```ts
import { createRotaCore } from '@rota-core/sdk';

const rota = createRotaCore({ serviceName: 'rota-identity' });

// on signup
await rota.events.publisher.publish({
  type: 'user.registered',
  source: 'rota-identity',
  actorId: user.id,
  idempotencyKey: `signup-${user.id}`,
  payload: { email: user.email, name: user.name },
});

// on password change
await rota.events.publisher.publish({
  type: 'user.password_changed',
  source: 'rota-identity',
  actorId: user.id,
});

// on OAuth client creation
await rota.events.publisher.publish({
  type: 'oauth.client.created',
  source: 'rota-identity',
  actorId: admin.id,
  targetId: client.id,
});
```

## What happens downstream

```txt
Rota Identity → user.registered
   ↓ Rota Events (stored, retried, replayable)
   ↓ Rota Notifications → welcome email + in-app notification
   ↓ Rota Workflows    → onboarding workflow (forum profile, admin notify, ...)
   ↓ Rota Analytics    → signup metric
   ↓ Rota Admin        → event viewer / audit trail
```
