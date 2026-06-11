/** Shared primitive and domain types used across all Rota Core packages. */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Core event shape used across the Rota ecosystem. */
export type RotaEvent = {
  id: string;
  type: string;
  source: string;
  actorId?: string;
  targetId?: string;
  correlationId?: string;
  idempotencyKey?: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: Date;
};

export type EventStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'dead_letter';

/** Standard API success envelope shared by every Rota service. */
export type ApiSuccess<T> = {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
};

/** Standard API error envelope shared by every Rota service. */
export type ApiFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    correlationId?: string;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

/** Identity context passed around for authorization-aware modules. */
export type RotaActor = {
  userId?: string;
  roles?: string[];
};
