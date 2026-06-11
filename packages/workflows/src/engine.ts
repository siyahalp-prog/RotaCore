import { NotFoundError, ValidationError, newId, systemClock, type Clock } from '@rota-core/core';
import { noopLogger, type Logger } from '@rota-core/logger';
import type { EventConsumer } from '@rota-core/events';
import type { RotaEvent } from '@rota-core/types';
import {
  workflowDefinitionSchema,
  type ActionFn,
  type StepRunLog,
  type WorkflowDefinition,
  type WorkflowDefinitionInput,
  type WorkflowRunLog,
} from './types.js';

export type WorkflowEngineOptions = {
  clock?: Clock;
  logger?: Logger;
  /** Maximum run logs kept in memory. */
  maxRunLogs?: number;
};

/**
 * Mini automation engine (Zapier/n8n style):
 * - actions are registered by name
 * - workflows are plain JSON definitions validated with Zod
 * - workflows are triggered by Rota Events
 * - each step supports retries and the whole run is logged
 */
export class WorkflowEngine {
  private readonly actions = new Map<string, ActionFn>();
  private readonly workflows = new Map<string, WorkflowDefinition>();
  private readonly runLogs: WorkflowRunLog[] = [];
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly maxRunLogs: number;

  constructor(options: WorkflowEngineOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.logger = options.logger ?? noopLogger;
    this.maxRunLogs = options.maxRunLogs ?? 1000;
  }

  registerAction(name: string, action: ActionFn): this {
    this.actions.set(name, action);
    return this;
  }

  /** Validate and register a JSON workflow definition. */
  registerWorkflow(definition: WorkflowDefinitionInput): WorkflowDefinition {
    const parsed = workflowDefinitionSchema.safeParse(definition);
    if (!parsed.success) {
      throw new ValidationError('Invalid workflow definition', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    for (const step of parsed.data.steps) {
      if (!this.actions.has(step.action)) {
        throw new NotFoundError(`Unknown action '${step.action}' in workflow '${parsed.data.id}'`, {
          action: step.action,
        });
      }
    }
    this.workflows.set(parsed.data.id, parsed.data);
    return parsed.data;
  }

  listWorkflows(): WorkflowDefinition[] {
    return [...this.workflows.values()];
  }

  listRunLogs(workflowId?: string): WorkflowRunLog[] {
    const logs =
      workflowId !== undefined
        ? this.runLogs.filter((r) => r.workflowId === workflowId)
        : [...this.runLogs];
    return logs.slice().reverse();
  }

  /** Run every enabled workflow whose trigger matches this event. */
  async handleEvent(event: RotaEvent): Promise<WorkflowRunLog[]> {
    const runs: WorkflowRunLog[] = [];
    for (const workflow of this.workflows.values()) {
      if (!workflow.enabled || workflow.trigger.event !== event.type) continue;
      runs.push(await this.runWorkflow(workflow, event));
    }
    return runs;
  }

  /** Bind this engine to a Rota Events consumer so events drive workflows. */
  bindToConsumer(consumer: EventConsumer): void {
    const triggerTypes = new Set([...this.workflows.values()].map((w) => w.trigger.event));
    for (const type of triggerTypes) {
      consumer.on(type, async (event) => {
        await this.handleEvent(event);
      });
    }
  }

  private async runWorkflow(
    workflow: WorkflowDefinition,
    event: RotaEvent,
  ): Promise<WorkflowRunLog> {
    const startedAt = this.clock.now();
    const stepLogs: StepRunLog[] = [];
    let aborted = false;

    for (const step of workflow.steps) {
      if (aborted) {
        stepLogs.push({ stepId: step.id, action: step.action, status: 'skipped', attempts: 0 });
        continue;
      }

      const action = this.actions.get(step.action);
      if (action === undefined) {
        stepLogs.push({
          stepId: step.id,
          action: step.action,
          status: 'failed',
          attempts: 0,
          error: `Action '${step.action}' is not registered`,
        });
        aborted = !step.continueOnError;
        continue;
      }

      const input = { ...event.payload, ...(step.input ?? {}) };
      let attempts = 0;
      let lastError: string | undefined;
      let output: unknown;
      let succeeded = false;

      while (attempts <= step.retries && !succeeded) {
        attempts += 1;
        try {
          output = await action({ event, workflowId: workflow.id, stepId: step.id }, input);
          succeeded = true;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          this.logger.warn('Workflow step failed', {
            workflowId: workflow.id,
            stepId: step.id,
            attempts,
            error: lastError,
          });
        }
      }

      stepLogs.push({
        stepId: step.id,
        action: step.action,
        status: succeeded ? 'completed' : 'failed',
        attempts,
        ...(succeeded ? { output } : { error: lastError }),
      });

      if (!succeeded && !step.continueOnError) aborted = true;
    }

    const failed = stepLogs.filter((s) => s.status === 'failed').length;
    const completed = stepLogs.filter((s) => s.status === 'completed').length;
    const run: WorkflowRunLog = {
      id: newId(),
      workflowId: workflow.id,
      triggerEventId: event.id,
      status: failed === 0 ? 'completed' : completed > 0 ? 'partial' : 'failed',
      steps: stepLogs,
      startedAt,
      finishedAt: this.clock.now(),
    };
    this.runLogs.push(run);
    if (this.runLogs.length > this.maxRunLogs) this.runLogs.shift();
    return run;
  }
}
