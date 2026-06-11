/** Shared error format for the whole Rota ecosystem. */
export class RotaError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: string,
    message: string,
    options?: { statusCode?: number; details?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'RotaError';
    this.code = code;
    this.statusCode = options?.statusCode ?? 500;
    this.details = options?.details;
  }

  toJSON(): { code: string; message: string; details?: Record<string, unknown> } {
    return {
      code: this.code,
      message: this.message,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

export class ValidationError extends RotaError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, { statusCode: 400, ...(details ? { details } : {}) });
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends RotaError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('NOT_FOUND', message, { statusCode: 404, ...(details ? { details } : {}) });
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends RotaError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONFLICT', message, { statusCode: 409, ...(details ? { details } : {}) });
    this.name = 'ConflictError';
  }
}

export class UnauthorizedError extends RotaError {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', message, { statusCode: 401 });
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends RotaError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message, { statusCode: 403 });
    this.name = 'ForbiddenError';
  }
}

export class RateLimitError extends RotaError {
  constructor(message = 'Too many requests. Please slow down.') {
    super('RATE_LIMITED', message, { statusCode: 429 });
    this.name = 'RateLimitError';
  }
}
