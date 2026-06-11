import { z } from 'zod';
import type { RotaEvent } from '@rota-core/types';

/** JSON workflow definition: which event triggers which sequence of actions. */
export const workflowStepSchema = z.object({
  id: z.string().min(1),
  action: z.string().min(1),
  /**
   * Static input passed to the action at runtime.
   * This is the ONLY source of the `input` parameter in ActionFn.
   * Event payload is available separately via `context.event.payload` and
   * is intentionally NOT merged here to prevent payload key injection attacks.
   */
  input: z.record(z.string(), z.unknown()).optional(),
  /** Retries per step (in addition to the first attempt). */
  retries: z.number().int().min(0).max(10).default(0),
  /** When true, a failing step does not abort the workflow. */
  continueOnError: z.boolean().default(false),
  /**
   * Maximum milliseconds this step's action may run before being forcibly
   * aborted with a timeout error. Default: 30 000 ms (30 s).
   * Range: 100 ms – 300 000 ms (5 min).
   */
  stepTimeoutMs: z.number().int().min(100).max(300_000).default(30_000),
});

export const workflowDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  trigger: z.object({
    /** Event type that starts this workflow, e.g. "user.registered". */
    event: z.string().min(1),
  }),
  steps: z.array(workflowStepSchema).min(1),
});

export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowDefinitionInput = z.input<typeof workflowDefinitionSchema>;

export type ActionContext = {
  event: RotaEvent;
  workflowId: string;
  stepId: string;
};

/**
 * Action function signature.
 *
 * SECURITY NOTE: `input` contains ONLY the static `step.input` from the
 * workflow definition. Event payload is accessible via `context.event.payload`
 * but is deliberately kept separate so workflow config cannot be overridden
 * by a malicious event publisher.
 */
export type ActionFn = (
  context: ActionContext,
  input: Record<string, unknown>,
) => Promise<unknown> | unknown;

export type StepRunLog = {
  stepId: string;
  action: string;
  status: 'completed' | 'failed' | 'skipped' | 'timed_out';
  attempts: number;
  error?: string | undefined;
  output?: unknown;
};

export type WorkflowRunLog = {
  id: string;
  workflowId: string;
  triggerEventId: string;
  status: 'completed' | 'failed' | 'partial';
  steps: StepRunLog[];
  startedAt: Date;
  finishedAt: Date;
};
