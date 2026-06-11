import { z } from 'zod';
import { ValidationError } from '@rota-core/core';

/** Base environment schema shared by every Rota service. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  /**
   * Secret bearer token required to access /admin/* routes.
   * Must be set in production. When undefined (local dev), admin routes
   * remain accessible without auth so developers can use them freely.
   * Generate with: openssl rand -hex 32
   */
  ADMIN_TOKEN: z.string().min(16).optional(),
  /**
   * Allowed CORS origin for browser-facing endpoints (/track, /track.js).
   * Set to your product domain(s) in production, e.g. 'https://rotaglobal.com'.
   * Defaults to '*' (all origins) when not set — safe only in development.
   */
  CORS_ORIGIN: z.string().optional(),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

/**
 * Validate an environment source against a Zod schema.
 * Throws a ValidationError listing every invalid/missing variable.
 */
export function loadEnv<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  source: Record<string, string | undefined> = process.env,
): z.infer<TSchema> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      variable: issue.path.join('.'),
      problem: issue.message,
    }));
    throw new ValidationError('Invalid environment configuration', { issues });
  }
  return result.data;
}

/** Convenience helper for the common case. */
export function loadBaseEnv(source?: Record<string, string | undefined>): BaseEnv {
  return loadEnv(baseEnvSchema, source);
}
