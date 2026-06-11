import { stableHash } from '@rota-core/core';
import type { FeatureFlag, FlagContext } from './types.js';

/**
 * Flag evaluation rules, in order:
 * 1. master `enabled` switch must be on
 * 2. user allowlist grants access
 * 3. role allowlist grants access
 * 4. percentage rollout buckets users deterministically (same user → same result)
 * 5. a flag with no targeting rules applies to everyone
 *
 * Anonymous users only pass when there are no targeting rules at all.
 */
export function evaluateFlag(flag: FeatureFlag, context: FlagContext = {}): boolean {
  if (!flag.enabled) return false;

  const hasUserRule = flag.allowedUserIds !== undefined && flag.allowedUserIds.length > 0;
  const hasRoleRule = flag.allowedRoles !== undefined && flag.allowedRoles.length > 0;
  const hasPercentageRule = flag.rolloutPercentage !== undefined;

  if (!hasUserRule && !hasRoleRule && !hasPercentageRule) return true;

  if (
    hasUserRule &&
    context.userId !== undefined &&
    flag.allowedUserIds!.includes(context.userId)
  ) {
    return true;
  }

  if (hasRoleRule && context.roles !== undefined) {
    const roles = new Set(context.roles);
    if (flag.allowedRoles!.some((role) => roles.has(role))) return true;
  }

  if (hasPercentageRule && context.userId !== undefined) {
    const bucket = stableHash(`${flag.key}:${context.userId}`) % 100;
    if (bucket < flag.rolloutPercentage!) return true;
  }

  return false;
}
