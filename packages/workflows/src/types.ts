import { z } from 'zod';
import type { RotaEvent } from '@rota-core/types';

/** JSON workflow definition: which event triggers which sequence of actions. */
export const workflowDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  trigger: z.object({
    /** Event type that starts this workflow, e.g. "user.registered". */
    event: z.string().min(1),
  }),
  steps: z
    .array(
      z.object({
        id: z.string().min(1),
        action: z.string().min(1),
        /** Static input merged with the trigger event payload at runtime. */
        input: z.record(z.string(), z.unknown()).optional(),
        /** Retries per step (in addition to the first attempt). */
        retries: z.number().int().min(0).max(10).default(0),
        /** When true, a failing step does not abort the workflow. */
        continueOnError: z.boolean().default(false),
      }),
    )
    .min(1),
});

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowDefinitionInput = z.input<typeof workflowDefinitionSchema>;

export type ActionContext = {
  event: RotaEvent;
  workflowId: string;
  stepId: string;
};

export type ActionFn = (
  context: ActionContext,
  input: Record<string, unknown>,
) => Promise<unknown> | unknown;

export type StepRunLog = {
  stepId: string;
  action: string;
  status: 'completed' | 'failed' | 'skipped';
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
