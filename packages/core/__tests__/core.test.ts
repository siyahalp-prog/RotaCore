import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  NotFoundError,
  RotaError,
  ValidationError,
  dayKeyUtc,
  fail,
  newId,
  ok,
  stableHash,
  toApiFailure,
} from '../src/index.js';

describe('@rota-core/core', () => {
  it('builds standard API envelopes', () => {
    expect(ok({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
    expect(fail('NOT_FOUND', 'missing')).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'missing' },
    });
  });

  it('converts errors into the shared failure envelope', () => {
    const failure = toApiFailure(new NotFoundError('User not found', { userId: 'u1' }));
    expect(failure.error.code).toBe('NOT_FOUND');
    expect(failure.error.details).toEqual({ userId: 'u1' });

    const unknown = toApiFailure(new Error('secret internals leaked?'));
    expect(unknown.error.code).toBe('INTERNAL_ERROR');
    expect(unknown.error.message).not.toContain('secret');
  });

  it('error classes carry codes and status codes', () => {
    expect(new ValidationError('x').statusCode).toBe(400);
    expect(new ConflictError('x').statusCode).toBe(409);
    expect(new RotaError('CUSTOM', 'x').statusCode).toBe(500);
  });

  it('generates unique ids and stable hashes', () => {
    expect(newId()).not.toBe(newId());
    expect(stableHash('abc')).toBe(stableHash('abc'));
    expect(stableHash('abc')).not.toBe(stableHash('abd'));
  });

  it('computes UTC day keys', () => {
    expect(dayKeyUtc(new Date('2026-01-15T23:59:59Z'))).toBe('2026-01-15');
  });
});
