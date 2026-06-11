import type { ApiFailure, ApiSuccess } from '@rota-core/types';
import { RotaError } from './errors.js';

/** Build a standard success envelope. */
export function ok<T>(data: T, meta?: Record<string, unknown>): ApiSuccess<T> {
  return { ok: true, data, ...(meta !== undefined ? { meta } : {}) };
}

/** Build a standard error envelope. */
export function fail(
  code: string,
  message: string,
  options?: { details?: Record<string, unknown>; correlationId?: string },
): ApiFailure {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(options?.details !== undefined ? { details: options.details } : {}),
      ...(options?.correlationId !== undefined ? { correlationId: options.correlationId } : {}),
    },
  };
}

/** Convert any thrown value into the shared API error envelope. */
export function toApiFailure(error: unknown, correlationId?: string): ApiFailure {
  if (error instanceof RotaError) {
    return fail(error.code, error.message, {
      ...(error.details !== undefined ? { details: error.details } : {}),
      ...(correlationId !== undefined ? { correlationId } : {}),
    });
  }
  return fail('INTERNAL_ERROR', 'An unexpected error occurred', {
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}
