import type { SqlClient } from '@rota-core/db';
import type { WorkflowDefinition, WorkflowRunLog } from './types.js';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * Storage boundary for workflow definitions and run history.
 * Implementations: InMemoryWorkflowStore (tests/dev), PostgresWorkflowStore (production).
 */
export type WorkflowStore = {
  /** Persist or update a workflow definition. */
  saveDefinition(definition: WorkflowDefinition): Promise<void>;
  /** Load all persisted workflow definitions. */
  loadDefinitions(): Promise<WorkflowDefinition[]>;
  /** Persist a completed run log entry. */
  saveRunLog(log: WorkflowRunLog): Promise<void>;
  /** Retrieve run logs, newest first. */
  listRunLogs(options?: { workflowId?: string; limit?: number }): Promise<WorkflowRunLog[]>;
};

// ---------------------------------------------------------------------------
// In-memory implementation (tests / local dev)
// ---------------------------------------------------------------------------

export class InMemoryWorkflowStore implements WorkflowStore {
  private readonly definitions = new Map<string, WorkflowDefinition>();
  private readonly runLogs: WorkflowRunLog[] = [];

  async saveDefinition(definition: WorkflowDefinition): Promise<void> {
    this.definitions.set(definition.id, { ...definition });
  }

  async loadDefinitions(): Promise<WorkflowDefinition[]> {
    return [...this.definitions.values()].map((d) => ({ ...d }));
  }

  async saveRunLog(log: WorkflowRunLog): Promise<void> {
    this.runLogs.push({ ...log });
  }

  async listRunLogs(options: { workflowId?: string; limit?: number } = {}): Promise<WorkflowRunLog[]> {
    let results = [...this.runLogs];
    if (options.workflowId !== undefined) {
      results = results.filter((r) => r.workflowId === options.workflowId);
    }
    return results
      .slice()
      .reverse()
      .slice(0, options.limit ?? 100)
      .map((r) => ({ ...r }));
  }
}

// ---------------------------------------------------------------------------
// PostgreSQL implementation
// ---------------------------------------------------------------------------

type WorkflowDefinitionRow = {
  id: string;
  name: string;
  definition: WorkflowDefinition;
  enabled: boolean;
};

type WorkflowRunRow = {
  id: string;
  workflow_id: string;
  trigger_event_id: string | null;
  status: string;
  steps: WorkflowRunLog['steps'];
  started_at: Date | string;
  finished_at: Date | string | null;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export class PostgresWorkflowStore implements WorkflowStore {
  constructor(private readonly sql: SqlClient) {}

  async saveDefinition(definition: WorkflowDefinition): Promise<void> {
    await this.sql.query(
      `INSERT INTO workflow_definitions (id, name, definition, enabled, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         definition = EXCLUDED.definition,
         enabled = EXCLUDED.enabled,
         updated_at = now()`,
      [definition.id, definition.name, JSON.stringify(definition), definition.enabled],
    );
  }

  async loadDefinitions(): Promise<WorkflowDefinition[]> {
    const result = await this.sql.query<WorkflowDefinitionRow>(
      `SELECT id, name, definition, enabled FROM workflow_definitions WHERE enabled = TRUE ORDER BY id`,
    );
    return result.rows.map((row) => ({
      ...(typeof row.definition === 'string'
        ? (JSON.parse(row.definition) as WorkflowDefinition)
        : row.definition),
      enabled: row.enabled,
    }));
  }

  async saveRunLog(log: WorkflowRunLog): Promise<void> {
    await this.sql.query(
      `INSERT INTO workflow_runs
         (id, workflow_id, trigger_event_id, status, steps, started_at, finished_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        log.id,
        log.workflowId,
        log.triggerEventId,
        log.status,
        JSON.stringify(log.steps),
        log.startedAt,
        log.finishedAt,
      ],
    );
  }

  async listRunLogs(options: { workflowId?: string; limit?: number } = {}): Promise<WorkflowRunLog[]> {
    const params: unknown[] = [options.limit ?? 100];
    const where = options.workflowId !== undefined
      ? `WHERE workflow_id = $2`
      : '';
    if (options.workflowId !== undefined) params.push(options.workflowId);

    const result = await this.sql.query<WorkflowRunRow>(
      `SELECT id, workflow_id, trigger_event_id, status, steps, started_at, finished_at
       FROM workflow_runs
       ${where}
       ORDER BY started_at DESC
       LIMIT $1`,
      params,
    );

    return result.rows.map((row) => ({
      id: row.id,
      workflowId: row.workflow_id,
      triggerEventId: row.trigger_event_id ?? '',
      status: row.status as WorkflowRunLog['status'],
      steps: typeof row.steps === 'string'
        ? (JSON.parse(row.steps) as WorkflowRunLog['steps'])
        : row.steps,
      startedAt: toDate(row.started_at),
      finishedAt: toDate(row.finished_at ?? row.started_at),
    }));
  }
}
