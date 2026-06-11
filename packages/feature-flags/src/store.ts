import type { FeatureFlag } from './types.js';

/** Storage boundary for feature flags. PostgreSQL schema lives in @rota-core/db. */
export type FlagStore = {
  get(key: string): Promise<FeatureFlag | null>;
  list(): Promise<FeatureFlag[]>;
  upsert(flag: FeatureFlag): Promise<void>;
  delete(key: string): Promise<boolean>;
};

export class InMemoryFlagStore implements FlagStore {
  private readonly flags = new Map<string, FeatureFlag>();

  async get(key: string): Promise<FeatureFlag | null> {
    const flag = this.flags.get(key);
    return flag !== undefined ? { ...flag } : null;
  }

  async list(): Promise<FeatureFlag[]> {
    return [...this.flags.values()].map((f) => ({ ...f }));
  }

  async upsert(flag: FeatureFlag): Promise<void> {
    this.flags.set(flag.key, { ...flag });
  }

  async delete(key: string): Promise<boolean> {
    return this.flags.delete(key);
  }
}
