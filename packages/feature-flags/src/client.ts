import { ValidationError, systemClock, type Clock } from '@rota-core/core';
import { evaluateFlag } from './evaluate.js';
import type { FlagStore } from './store.js';
import type { FeatureFlag, FlagContext, UpsertFlagInput } from './types.js';

/**
 * SDK helper used by Rota products:
 *
 *   const flags = new FeatureFlagClient(store);
 *   if (await flags.isEnabled('new-forum', { userId, roles })) { ... }
 *
 * Flags are cached briefly so hot paths don't hit the store on every call.
 */
export class FeatureFlagClient {
  private readonly cache = new Map<string, { flag: FeatureFlag | null; expiresAt: number }>();

  constructor(
    private readonly store: FlagStore,
    private readonly options: { cacheTtlMs?: number; clock?: Clock } = {},
  ) {}

  private get clock(): Clock {
    return this.options.clock ?? systemClock;
  }

  async isEnabled(key: string, context: FlagContext = {}): Promise<boolean> {
    const flag = await this.getFlag(key);
    if (flag === null) return false;
    return evaluateFlag(flag, context);
  }

  private async getFlag(key: string): Promise<FeatureFlag | null> {
    const ttl = this.options.cacheTtlMs ?? 5_000;
    const now = this.clock.now().getTime();
    const cached = this.cache.get(key);
    if (cached !== undefined && cached.expiresAt > now) return cached.flag;
    const flag = await this.store.get(key);
    this.cache.set(key, { flag, expiresAt: now + ttl });
    return flag;
  }

  invalidateCache(): void {
    this.cache.clear();
  }

  // -------------------------------------------------------- admin functions

  async upsertFlag(input: UpsertFlagInput): Promise<FeatureFlag> {
    if (
      input.rolloutPercentage !== undefined &&
      (input.rolloutPercentage < 0 || input.rolloutPercentage > 100)
    ) {
      throw new ValidationError('rolloutPercentage must be between 0 and 100');
    }
    const flag: FeatureFlag = {
      key: input.key,
      description: input.description ?? '',
      enabled: input.enabled,
      rolloutPercentage: input.rolloutPercentage,
      allowedRoles: input.allowedRoles,
      allowedUserIds: input.allowedUserIds,
      updatedAt: this.clock.now(),
    };
    await this.store.upsert(flag);
    this.cache.delete(input.key);
    return flag;
  }

  async listFlags(): Promise<FeatureFlag[]> {
    return this.store.list();
  }

  async deleteFlag(key: string): Promise<boolean> {
    this.cache.delete(key);
    return this.store.delete(key);
  }
}
