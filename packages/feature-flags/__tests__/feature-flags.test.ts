import { describe, expect, it } from 'vitest';
import { FeatureFlagClient, InMemoryFlagStore, evaluateFlag } from '../src/index.js';
import type { FeatureFlag } from '../src/index.js';

function flag(partial: Partial<FeatureFlag> & Pick<FeatureFlag, 'key'>): FeatureFlag {
  return { description: '', enabled: true, updatedAt: new Date(), ...partial };
}

function setup() {
  const store = new InMemoryFlagStore();
  const client = new FeatureFlagClient(store, { cacheTtlMs: 0 });
  return { store, client };
}

describe('Rota Feature Flags', () => {
  it('disabled master switch turns the flag off for everyone', () => {
    const f = flag({ key: 'x', enabled: false, allowedUserIds: ['u1'] });
    expect(evaluateFlag(f, { userId: 'u1' })).toBe(false);
  });

  it('flag with no targeting rules applies to everyone', () => {
    const f = flag({ key: 'x' });
    expect(evaluateFlag(f)).toBe(true);
    expect(evaluateFlag(f, { userId: 'u1' })).toBe(true);
  });

  it('user-based rollout', () => {
    const f = flag({ key: 'ai-guide', allowedUserIds: ['admin-1'] });
    expect(evaluateFlag(f, { userId: 'admin-1' })).toBe(true);
    expect(evaluateFlag(f, { userId: 'user-2' })).toBe(false);
  });

  it('role-based rollout', () => {
    const f = flag({ key: 'new-dashboard', allowedRoles: ['beta'] });
    expect(evaluateFlag(f, { userId: 'u1', roles: ['beta'] })).toBe(true);
    expect(evaluateFlag(f, { userId: 'u2', roles: ['member'] })).toBe(false);
  });

  it('percentage rollout is deterministic and roughly proportional', () => {
    const f = flag({ key: 'new-forum', rolloutPercentage: 30 });

    const first = evaluateFlag(f, { userId: 'user-42' });
    for (let i = 0; i < 10; i++) {
      expect(evaluateFlag(f, { userId: 'user-42' })).toBe(first);
    }

    let enabled = 0;
    const total = 2000;
    for (let i = 0; i < total; i++) {
      if (evaluateFlag(f, { userId: `user-${i}` })) enabled += 1;
    }
    const ratio = enabled / total;
    expect(ratio).toBeGreaterThan(0.25);
    expect(ratio).toBeLessThan(0.35);
  });

  it('anonymous users are excluded from targeted rollouts', () => {
    expect(evaluateFlag(flag({ key: 'x', rolloutPercentage: 99 }))).toBe(false);
    expect(evaluateFlag(flag({ key: 'x', allowedRoles: ['admin'] }))).toBe(false);
  });

  it('SDK client: upsert, evaluate, list, delete', async () => {
    const { client } = setup();
    await client.upsertFlag({ key: 'new-forum', enabled: true, rolloutPercentage: 100 });

    expect(await client.isEnabled('new-forum', { userId: 'u1' })).toBe(true);
    expect(await client.isEnabled('missing-flag', { userId: 'u1' })).toBe(false);

    expect(await client.listFlags()).toHaveLength(1);
    expect(await client.deleteFlag('new-forum')).toBe(true);
    expect(await client.isEnabled('new-forum', { userId: 'u1' })).toBe(false);
  });

  it('rejects invalid rollout percentages', async () => {
    const { client } = setup();
    await expect(
      client.upsertFlag({ key: 'bad', enabled: true, rolloutPercentage: 150 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
