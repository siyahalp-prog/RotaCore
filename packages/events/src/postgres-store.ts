import type { SqlClient } from '@rota-core/db';
import type { EventStatus } from '@rota-core/types';
import type { EventStore, EventUpdate } from './store.js';
import type { StoredEvent, EventFilter } from './types.js';
import { newId } from '@rota-core/core';

type EventRow = {
  id: string;
  type: string;
  source: string;
  actor_id: string | null;
  target_id: string | null;
  correlation_id: string | null;
  idempotency_key: string | null;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
  status: EventStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  next_attempt_at: Date | string | null;
  processed_at: Date | string | null;
  created_at: Date | string;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function rowToEvent(row: EventRow): StoredEvent {
  return {
    id: row.id,
    type: row.type,
    source: row.source,
    ...(row.actor_id !== null ? { actorId: row.actor_id } : {}),
    ...(row.target_id !== null ? { targetId: row.target_id } : {}),
    ...(row.correlation_id !== null ? { correlationId: row.correlation_id } : {}),
    ...(row.idempotency_key !== null ? { idempotencyKey: row.idempotency_key } : {}),
    payload: row.payload,
    ...(row.metadata !== null ? { metadata: row.metadata } : {}),
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    ...(row.last_error !== null ? { lastError: row.last_error } : {}),
    ...(row.next_attempt_at !== null ? { nextAttemptAt: toDate(row.next_attempt_at) } : {}),
    ...(row.processed_at !== null ? { processedAt: toDate(row.processed_at) } : {}),
    createdAt: toDate(row.created_at),
  };
}

/**
 * Minimal SQL parameter builder for PostgreSQL ($1, $2, …).
 * Returns a helper that accumulates values and returns the correct placeholder.
 *
 * Usage:
 *   const [params, p] = makeParams();
 *   sql = `SELECT * FROM t WHERE a = ${p(1)} AND b = ${p('x')}`;
 *   // sql  → "SELECT * FROM t WHERE a = $1 AND b = $2"
 *   // params → [1, 'x']
 */
function makeParams(): [unknown[], (value: unknown) => string] {
  const params: unknown[] = [];
  const p = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  return [params, p];
}

/**
 * PostgreSQL event store. Uses FOR UPDATE SKIP LOCKED so multiple consumers
 * can claim events concurrently without double-processing.
 */
export class PostgresEventStore implements EventStore {
  constructor(private readonly sql: SqlClient) {}

  async insert(event: StoredEvent): Promise<void> {
    await this.sql.query(
      `INSERT INTO rota_events
        (id, type, source, actor_id, target_id, correlation_id, idempotency_key,
         payload, metadata, status, attempts, max_attempts, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        event.id,
        event.type,
        event.source,
        event.actorId ?? null,
        event.targetId ?? null,
        event.correlationId ?? null,
        event.idempotencyKey ?? null,
        JSON.stringify(event.payload),
        event.metadata !== undefined ? JSON.stringify(event.metadata) : null,
        event.status,
        event.attempts,
        event.maxAttempts,
        event.createdAt,
      ],
    );
  }

  async findById(id: string): Promise<StoredEvent | null> {
    const result = await this.sql.query<EventRow>(`SELECT * FROM rota_events WHERE id = $1`, [id]);
    const row = result.rows[0];
    return row !== undefined ? rowToEvent(row) : null;
  }

  async findByIdempotencyKey(key: string): Promise<StoredEvent | null> {
    const result = await this.sql.query<EventRow>(
      `SELECT * FROM rota_events WHERE idempotency_key = $1`,
      [key],
    );
    const row = result.rows[0];
    return row !== undefined ? rowToEvent(row) : null;
  }

  async claimPending(options: {
    limit: number;
    now: Date;
    types?: string[];
  }): Promise<StoredEvent[]> {
    const typeFilter = options.types !== undefined ? `AND type = ANY($3)` : '';
    const params: unknown[] = [options.limit, options.now];
    if (options.types !== undefined) params.push(options.types);
    const result = await this.sql.query<EventRow>(
      `UPDATE rota_events SET status = 'processing'
       WHERE id IN (
         SELECT id FROM rota_events
         WHERE status = 'pending'
           AND (next_attempt_at IS NULL OR next_attempt_at <= $2)
           ${typeFilter}
         ORDER BY created_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      params,
    );
    return result.rows.map(rowToEvent);
  }

  async update(id: string, patch: EventUpdate): Promise<void> {
    const [params, p] = makeParams();
    const idPlaceholder = p(id); // always $1
    const sets: string[] = [];

    if (patch.status !== undefined) sets.push(`status = ${p(patch.status)}`);
    if (patch.attempts !== undefined) sets.push(`attempts = ${p(patch.attempts)}`);
    if ('lastError' in patch) sets.push(`last_error = ${p(patch.lastError ?? null)}`);
    if ('nextAttemptAt' in patch) sets.push(`next_attempt_at = ${p(patch.nextAttemptAt ?? null)}`);
    if ('processedAt' in patch) sets.push(`processed_at = ${p(patch.processedAt ?? null)}`);

    if (sets.length === 0) return;
    await this.sql.query(
      `UPDATE rota_events SET ${sets.join(', ')} WHERE id = ${idPlaceholder}`,
      params,
    );
  }

  async list(filter: EventFilter = {}): Promise<StoredEvent[]> {
    const [params, p] = makeParams();
    const wheres: string[] = [];

    if (filter.type !== undefined) wheres.push(`type = ${p(filter.type)}`);
    if (filter.status !== undefined) wheres.push(`status = ${p(filter.status)}`);
    if (filter.correlationId !== undefined) wheres.push(`correlation_id = ${p(filter.correlationId)}`);

    const whereClause = wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : '';
    const limitPlaceholder = p(filter.limit ?? 100);

    const result = await this.sql.query<EventRow>(
      `SELECT * FROM rota_events
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ${limitPlaceholder}`,
      params,
    );
    return result.rows.map(rowToEvent);
  }

  async recordDeadLetter(eventId: string, reason: string): Promise<void> {
    await this.sql.query(
      `INSERT INTO rota_event_dead_letters (id, event_id, reason) VALUES ($1, $2, $3)`,
      [newId(), eventId, reason],
    );
  }

  async listDeadLetters(): Promise<{ eventId: string; reason: string; createdAt: Date }[]> {
    const result = await this.sql.query<{
      event_id: string;
      reason: string;
      created_at: Date | string;
    }>(`SELECT event_id, reason, created_at FROM rota_event_dead_letters ORDER BY created_at DESC`);
    return result.rows.map((row) => ({
      eventId: row.event_id,
      reason: row.reason,
      createdAt: toDate(row.created_at),
    }));
  }

  async recoverStuck(olderThan: Date): Promise<number> {
    const result = await this.sql.query<{ count: string }>(
      `WITH recovered AS (
         UPDATE rota_events
         SET status = 'pending',
             processed_at = NULL
         WHERE status = 'processing'
           AND created_at <= $1
         RETURNING id
       )
       SELECT COUNT(*) AS count FROM recovered`,
      [olderThan],
    );
    const row = result.rows[0];
    return row !== undefined ? Number(row.count) : 0;
  }
}
