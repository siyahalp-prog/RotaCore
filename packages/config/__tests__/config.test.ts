import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { baseEnvSchema, loadBaseEnv, loadEnv } from '../src/index.js';

describe('@rota-core/config', () => {
  it('loads and validates env with defaults', () => {
    const env = loadBaseEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('rejects invalid env with a detailed error', () => {
    expect(() => loadBaseEnv({ NODE_ENV: 'staging' })).toThrowError(
      /Invalid environment configuration/,
    );
  });

  it('supports extending the base schema', () => {
    const schema = baseEnvSchema.extend({ API_PORT: z.coerce.number().int() });
    const env = loadEnv(schema, { API_PORT: '8080' });
    expect(env.API_PORT).toBe(8080);
  });
});
