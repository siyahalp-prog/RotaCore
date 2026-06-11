# Rota Workflow Engine

Mini Zapier/n8n-style automation engine driven by Rota Events.

## Concepts

- **Action** — a named function registered on the engine
  (`send.welcome.email`, `create.forum.profile`, `track.analytics`, ...).
- **Workflow** — a JSON definition (Zod-validated): a trigger event plus a
  sequence of steps.
- **Run log** — every execution records per-step status, attempts, output or
  error, for the admin workflow viewer.

## JSON workflow definition

```json
{
  "id": "user-onboarding",
  "name": "User onboarding",
  "trigger": { "event": "user.registered" },
  "steps": [
    { "id": "welcome", "action": "send.welcome.email", "retries": 2 },
    { "id": "forum", "action": "create.forum.profile" },
    {
      "id": "metrics",
      "action": "track.analytics",
      "input": { "event": "signup" },
      "continueOnError": true
    },
    { "id": "admin", "action": "notify.admin" }
  ]
}
```

Step semantics:

- `retries` — extra attempts per step (in addition to the first).
- `continueOnError` — failing step does not abort the rest of the workflow.
- Step input = trigger event payload merged with the static `input` object.

## Usage

```ts
import { WorkflowEngine } from '@rota-core/workflows';

const engine = new WorkflowEngine({ logger });
engine.registerAction('send.welcome.email', async (ctx, input) => {
  /* ... */
});
engine.registerWorkflow(definition);

// drive it from Rota Events:
engine.bindToConsumer(consumer);

// admin viewer data:
engine.listWorkflows();
engine.listRunLogs('user-onboarding');
```

Run status: `completed` (all steps ok), `partial` (some failed but run continued),
`failed` (aborted with no completed steps after the failure).

PostgreSQL schemas (`workflow_definitions`, `workflow_runs`) are prepared in
`packages/db` for persistence (currently in-memory).
