# Rota Feature Flags

Controlled rollout of new features across Rota products.

## Flag model

```ts
{
  key: 'new-forum',
  description: 'New forum system',
  enabled: true,             // master switch
  rolloutPercentage?: 10,    // stable per-user bucketing (FNV-1a hash)
  allowedRoles?: ['beta'],
  allowedUserIds?: ['admin-1'],
}
```

## Evaluation rules (in order)

1. `enabled: false` → off for everyone.
2. User allowlist match → on.
3. Role allowlist match → on.
4. Percentage rollout → deterministic per `flag.key + userId`.
5. No targeting rules at all → on for everyone.
6. Anonymous users only pass rule 5.

## SDK helper

```ts
import { FeatureFlagClient, InMemoryFlagStore } from '@rota-core/feature-flags';

const flags = new FeatureFlagClient(new InMemoryFlagStore()); // 5s cache by default

// examples from the roadmap:
await flags.upsertFlag({ key: 'new-forum', enabled: true, rolloutPercentage: 10 });
await flags.upsertFlag({ key: 'new-ai-guide', enabled: true, allowedRoles: ['admin'] });
await flags.upsertFlag({ key: 'new-dashboard', enabled: true, allowedRoles: ['beta'] });

if (await flags.isEnabled('new-forum', { userId, roles })) {
  // render the new forum
}
```

Admin functions: `upsertFlag`, `listFlags`, `deleteFlag` (the Admin Hub UI will
call these). The API evaluates flags at `GET /flags/:key?userId=&roles=`.

PostgreSQL schema (`feature_flags`) lives in `packages/db`.
