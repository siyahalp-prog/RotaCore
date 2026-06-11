import { newId, systemClock, type Clock } from '@rota-core/core';
import { noopLogger, type Logger } from '@rota-core/logger';
import type { RotaEvent } from '@rota-core/types';
import type { EventConsumer } from '@rota-core/events';
import { InMemoryWorkflowStore, type WorkflowStore } from './store.js';
import type {
  ActionContext,
  ActionFn,
  StepRunLog,
  WorkflowDefinition,
  WorkflowDefinitionInput,
  WorkflowRunLog,
} from './types.js';
import { workflowDefinitionSchema } from './types.js';

export type WorkflowEngineOptions = {
  logger?: Logger;
  clock?: Clock;
  /**
   * Persistence store for definitions and run history.
   * Defaults to InMemoryWorkflowStore (lost on restart).
   * Use PostgresWorkflowStore for durable persistence.
   */
  store?: WorkflowStore;
  /**
   * Default step timeout in milliseconds.
   * Overridden per-step via WorkflowStep.stepTimeoutMs.
   * Default: 30 000 ms (30 s).
   */
  defaultStepTimeoutMs?: number;
  /** Maximum run log entries kept in memory for quick reporting. Default: 1000. */
  maxRunLogs?: number;
};

/** Returns a Promise that rejects after `ms` milliseconds. */
function timeout(ms: number, label: string): Promise<never> {
  return new Promise((_, reject) => {
    const t = setTimeout(
      () => reject(new Error(`Step '${label}' timed out after ${ms}ms`)),
      ms,
    );
    // Don't hold the Node.js process open just for a timeout
    if (typeof t === 'object' && 'unref' in t) (t as NodeJS.Timeout).unref();
  });
}

export class WorkflowEngine {
  private readonly workflows = new Map<string, WorkflowDefinition>();
  private readonly actions = new Map<string, ActionFn>();
  /** Recent run logs kept in memory for O(1) dashboard access. */
  private readonly runLogs: WorkflowRunLog[] = [];

  private readonly logger: Logger;
  private readonly clock: Clock;
  private readonly store: WorkflowStore;
  private readonly defaultStepTimeoutMs: number;
  private readonly maxRunLogs: number;

  constructor(options: WorkflowEngineOptions = {}) {
    this.logger = options.logger ?? noopLogger;
    this.clock = options.clock ?? systemClock;
    this.store = options.store ?? new InMemoryWorkflowStore();
    this.defaultStepTimeoutMs = options.defaultStepTimeoutMs ?? 30_000;
    this.maxRunLogs = options.maxRunLogs ?? 1_000;
  }

  // ---------------------------------------------------------------------------
  // Definition management
  // ---------------------------------------------------------------------------

  registerAction(name: string, fn: ActionFn): void {
    this.actions.set(name, fn);
  }

  registerWorkflow(input: WorkflowDefinitionInput): WorkflowDefinition {
    const definition = workflowDefinitionSchema.parse(input);
    this.workflows.set(definition.id, definition);
    // Persist asynchronously — failures are logged but never throw to caller
    this.store.saveDefinition(definition).catch((error: unknown) => {
      this.logger.warn('Failed to persist workflow definition', {
        workflowId: definition.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return definition;
  }

  /**
   * Load persisted workflow definitions from the store into memory.
   * Call once at startup after registering all local workflows so the engine
   * can resume definitions that were registered in a previous process run.
   */
  async loadFromStore(): Promise<number> {
    const definitions = await this.store.loadDefinitions();
    let loaded = 0;
    for (const def of definitions) {
      if (!this.workflows.has(def.id)) {
        this.workflows.set(def.id, def);
        loaded += 1;
      }
    }
    return loaded;
  }

  getWorkflow(id: string): WorkflowDefinition | null {
    return this.workflows.get(id) ?? null;
  }

  listWorkflows(): WorkflowDefinition[] {
    return [...this.workflows.values()];
  }

  // ---------------------------------------------------------------------------
  // Event-consumer binding
  // ---------------------------------------------------------------------------

  /**
   * Register event handlers on a consumer for every currently registered workflow.
   * ⚠ Call AFTER all workflows are registered — trigger types are snapshotted at bind time.
   */
  bindToConsumer(consumer: EventConsumer): void {
    const triggerTypes = new Set<string>();
    for (const wf of this.workflows.values()) {
      triggerTypes.add(wf.trigger.event);
    }

    for (const eventType of triggerTypes) {
      consumer.on(eventType, async (event: RotaEvent) => {
        await this.runMatchingWorkflows(event);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  private async runMatchingWorkflows(event: RotaEvent): Promise<void> {
    for (const workflow of this.workflows.values()) {
      if (!workflow.enabled) continue;
      if (workflow.trigger.event !== event.type) continue;
      await this.runWorkflow(workflow, event);
    }
  }

  async runWorkflow(workflow: WorkflowDefinition, event: RotaEvent): Promise<WorkflowRunLog> {
    const startedAt = this.clock.now();
    const stepLogs: StepRunLog[] = [];

    this.logger.info('Workflow started', {
      workflowId: workflow.id,
      eventType: event.type,
      eventId: event.id,
    });

    for (const step of workflow.steps) {
      const action = this.actions.get(step.action);

      if (action === undefined) {
        this.logger.warn('Unknown workflow action — skipping step', {
          workflowId: workflow.id,
          stepId: step.id,
          action: step.action,
        });
        stepLogs.push({
          stepId: step.id,
          action: step.action,
          status: 'skipped',
          attempts: 0,
          error: `Action '${step.action}' is not registered`,
        });
        continue;
      }

      const context: ActionContext = { event, workflowId: workflow.id, stepId: step.id };

      /**
       * SECURITY: `input` contains ONLY the static step.input from the workflow definition.
       * `event.payload` is intentionally NOT merged — this prevents a malicious event publisher
       * from overriding workflow step configuration by injecting keys into the event payload.
       * Actions that need event data must access it via `context.event.payload`.
       */
      const input: Record<string, unknown> = step.input ?? {};
      const stepTimeoutMs = step.stepTimeoutMs ?? this.defaultStepTimeoutMs;

      let attempts = 0;
      let succeeded = false;
      let lastError: string | undefined;
      let output: unknown;

      // Retry loop
      while (attempts <= step.retries) {
        attempts += 1;
        try {
          output = await Promise.race([
            Promise.resolve(action(context, input)),
            timeout(stepTimeoutMs, step.id),
          ]);
          succeeded = true;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          const isTimeout = lastError.includes('timed out');

          this.logger.warn('Workflow step failed', {
            workflowId: workflow.id,
            stepId: step.id,
            attempt: attempts,
            error: lastError,
            timedOut: isTimeout,
          });

          if (isTimeout) {
            // Do not retry on timeout — the action may have leaked side-effects
            stepLogs.push({
              stepId: step.id,
              action: step.action,
              status: 'timed_out',
              attempts,
              error: lastError,
            });

            if (!step.continueOnError) {
              return this.finishRun(workflow, event, stepLogs, 'failed', startedAt);
            }
            break; // proceed to next step
          }

          if (attempts > step.retries) break; // exhaust retries
        }
      }

      if (succeeded) {
        stepLogs.push({
          stepId: step.id,
          action: step.action,
          status: 'completed',
          attempts,
          output,
        });
      } else if (stepLogs.at(-1)?.stepId !== step.id) {
        // Only add a failed entry if timeout handler didn't already add one
        stepLogs.push({
          stepId: step.id,
          action: step.action,
          status: 'failed',
          attempts,
          error: lastError,
        });

        if (!step.continueOnError) {
          return this.finishRun(workflow, event, stepLogs, 'failed', startedAt);
        }
      }
    }

    const allCompleted = stepLogs.every((s) => s.status === 'completed');
    return this.finishRun(
      workflow,
      event,
      stepLogs,
      allCompleted ? 'completed' : 'partial',
      startedAt,
    );
  }

  private async finishRun(
    workflow: WorkflowDefinition,
    event: RotaEvent,
    steps: StepRunLog[],
    status: WorkflowRunLog['status'],
    startedAt: Date,
  ): Promise<WorkflowRunLog> {
    const log: WorkflowRunLog = {
      id: newId(),
      workflowId: workflow.id,
      triggerEventId: event.id,
      status,
      steps,
      startedAt,
      finishedAt: this.clock.now(),
    };

    this.logger.info('Workflow finished', {
      workflowId: workflow.id,
      status: log.status,
      stepCount: steps.length,
    });

    // Keep in-memory ring buffer for dashboard access
    this.runLogs.push(log);
    if (this.runLogs.length > this.maxRunLogs) this.runLogs.shift();

    // Persist asynchronously
    this.store.saveRunLog(log).catch((error: unknown) => {
      this.logger.warn('Failed to persist workflow run log', {
        runId: log.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return log;
  }

  // ---------------------------------------------------------------------------
  // Reporting
  // ---------------------------------------------------------------------------

  listRunLogs(workflowId?: string): WorkflowRunLog[] {
    if (workflowId === undefined) return [...this.runLogs].reverse();
    return this.runLogs.filter((r) => r.workflowId === workflowId).reverse();
  }
}
