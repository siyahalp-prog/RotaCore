import { z } from 'zod';
import { ValidationError } from '@rota-core/core';

/** Base environment schema shared by every Rota service. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
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
