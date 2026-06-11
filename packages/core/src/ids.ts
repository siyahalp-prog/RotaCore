import { randomUUID } from 'node:crypto';

/** Generate a unique id for entities across Rota Core. */
export function newId(): string {
  return randomUUID();
}

/** Stable non-cryptographic hash (FNV-1a). Used for deterministic bucketing. */
export function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
