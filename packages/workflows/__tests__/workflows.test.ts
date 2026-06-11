import { describe, expect, it } from 'vitest';
import { EventConsumer, EventPublisher, InMemoryEventStore } from '@rota-core/events';
import { WorkflowEngine, InMemoryWorkflowStore } from '../src/index.js';
import type { RotaEvent } from '@rota-core/types';

function triggerEvent(type = 'user.registered', payload: Record<string, unknown> = {}): RotaEvent {
  return {
    id: 'evt-1',
    type,
    source: 'rota-identity',
    payload: { userId: 'u1', email: 'a@rota.app', ...payload },
    createdAt: new Date(),
  };
}

describe('Rota Workflow Engine', () => {
  // ---------------------------------------------------------------- definition
  it('validates workflow definitions', () => {
    const engine = new WorkflowEngine();
    expect(() =>
      engine.registerWorkflow({ id: '', name: '', trigger: { event: '' }, steps: [] }),
    ).toThrowError();
  });

  it('registers workflow with unknown action without throwing (action absence is a runtime warning)', () => {
    const engine = new WorkflowEngine();
    // Registration succeeds — the action absence is detected at run time and the step is skipped.
    const wf = engine.registerWorkflow({
      id: 'wf-unknown',
      name: 'Unknown action test',
      trigger: { event: 'user.registered' },
      steps: [{ id: 's1', action: 'does.not.exist' }],
    });
    expect(wf.id).toBe('wf-unknown');
  });

  // ---------------------------------------------------------------- step execution
  it('runs all steps in order with step.input (not merged with event.payload)', async () => {
    const engine = new WorkflowEngine();
    const calls: string[] = [];

    // Actions receive step.input only — NOT event.payload
    engine.registerAction('send.welcome.email', (_ctx, input) => {
      // step.input provides the recipient template; event.payload is in ctx.event.payload
      calls.push(`email:${input['recipient'] as string}`);
    });
    engine.registerAction('create.forum.profile', (ctx, _input) => {
      // Access event data via context, not input
      calls.push(`forum:${ctx.event.payload['userId'] as string}`);
      return { profileId: 'p1' };
    });

    engine.registerWorkflow({
      id: 'onboarding',
      name: 'User onboarding',
      trigger: { event: 'user.registered' },
      steps: [
        { id: 's1', action: 'send.welcome.email', input: { recipient: 'welcome@rota.app' } },
        { id: 's2', action: 'create.forum.profile' },
      ],
    });

    const run = await engine.runWorkflow(engine.getWorkflow('onboarding')!, triggerEvent());
    expect(calls).toEqual(['email:welcome@rota.app', 'forum:u1']);
    expect(run.status).toBe('completed');
    expect(run.steps[1]?.output).toEqual({ profileId: 'p1' });
  });

  it('retries failing steps up to retries count', async () => {
    const engine = new WorkflowEngine();
    let attempts = 0;
    engine.registerAction('flaky', () => {
      attempts += 1;
      if (attempts < 3) throw new Error('transient');
    });
    engine.registerWorkflow({
      id: 'wf-retry',
      name: 'Retry test',
      trigger: { event: 'user.registered' },
      steps: [{ id: 's1', action: 'flaky', retries: 3 }],
    });

    const run = await engine.runWorkflow(engine.getWorkflow('wf-retry')!, triggerEvent());
    expect(run.status).toBe('completed');
    expect(run.steps[0]?.attempts).toBe(3);
  });

  it('aborts remaining steps on failure unless continueOnError', async () => {
    const engine = new WorkflowEngine();
    const calls: string[] = [];
    engine.registerAction('boom', () => {
      throw new Error('fatal');
    });
    engine.registerAction('after', () => {
      calls.push('after');
    });

    engine.registerWorkflow({
      id: 'wf-abort',
      name: 'Abort test',
      trigger: { event: 'user.registered' },
      steps: [
        { id: 's1', action: 'boom' },
        { id: 's2', action: 'after' },
      ],
    });
    const abortRun = await engine.runWorkflow(engine.getWorkflow('wf-abort')!, triggerEvent());
    expect(abortRun.status).toBe('failed');
    // step s2 should not appear in logs when the workflow aborted before it ran
    expect(abortRun.steps).toHaveLength(1);
    expect(calls).toEqual([]);

    engine.registerWorkflow({
      id: 'wf-continue',
      name: 'Continue test',
      trigger: { event: 'post.created' },
      steps: [
        { id: 's1', action: 'boom', continueOnError: true },
        { id: 's2', action: 'after' },
      ],
    });
    const continueRun = await engine.runWorkflow(
      engine.getWorkflow('wf-continue')!,
      triggerEvent('post.created'),
    );
    expect(continueRun.status).toBe('partial');
    expect(calls).toEqual(['after']);
  });

  // ---------------------------------------------------------------- timeout
  it('aborts a step that exceeds stepTimeoutMs and marks it timed_out', async () => {
    const engine = new WorkflowEngine();
    engine.registerAction('slow', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000)); // 5 s — too slow
    });
    engine.registerWorkflow({
      id: 'wf-timeout',
      name: 'Timeout test',
      trigger: { event: 'user.registered' },
      steps: [{ id: 's1', action: 'slow', stepTimeoutMs: 150 }], // 150 ms limit (schema min: 100)
    });

    const run = await engine.runWorkflow(engine.getWorkflow('wf-timeout')!, triggerEvent());
    expect(run.status).toBe('failed');
    expect(run.steps[0]?.status).toBe('timed_out');
    expect(run.steps[0]?.error).toContain('timed out');
  }, 1000); // overall test timeout

  // ---------------------------------------------------------------- payload isolation
  it('event.payload keys do NOT override step.input (payload injection prevention)', async () => {
    const engine = new WorkflowEngine();
    const received: Record<string, unknown>[] = [];
    engine.registerAction('capture', (_ctx, input) => {
      received.push({ ...input });
    });

    engine.registerWorkflow({
      id: 'wf-isolation',
      name: 'Isolation test',
      trigger: { event: 'user.registered' },
      steps: [
        {
          id: 's1',
          action: 'capture',
          // Static step config: action should send to this role only
          input: { role: 'user', maxBudget: 100 },
        },
      ],
    });

    // Malicious event payload tries to override step.input keys
    const maliciousEvent = triggerEvent('user.registered', {
      role: 'admin',       // attempt to escalate role
      maxBudget: 999_999,  // attempt to inflate budget
    });

    await engine.runWorkflow(engine.getWorkflow('wf-isolation')!, maliciousEvent);
    // step.input must be untouched; event.payload is not merged
    expect(received[0]).toEqual({ role: 'user', maxBudget: 100 });
  });

  // ---------------------------------------------------------------- persistence
  it('persists definitions and run logs via WorkflowStore', async () => {
    const store = new InMemoryWorkflowStore();
    const engine = new WorkflowEngine({ store });

    engine.registerAction('noop', () => undefined);
    engine.registerWorkflow({
      id: 'wf-persist',
      name: 'Persist test',
      trigger: { event: 'user.registered' },
      steps: [{ id: 's1', action: 'noop' }],
    });

    await engine.runWorkflow(engine.getWorkflow('wf-persist')!, triggerEvent());

    // Definitions and run logs are in the store
    const defs = await store.loadDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]?.id).toBe('wf-persist');

    const logs = await store.listRunLogs({ workflowId: 'wf-persist' });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.status).toBe('completed');
  });

  it('loads definitions from store on startup', async () => {
    const store = new InMemoryWorkflowStore();
    // Pre-populate the store (simulates a previous process run)
    await store.saveDefinition({
      id: 'wf-loaded',
      name: 'Loaded from store',
      enabled: true,
      trigger: { event: 'user.registered' },
      steps: [{ id: 's1', action: 'noop', retries: 0, continueOnError: false, stepTimeoutMs: 30_000 }],
    });

    const engine = new WorkflowEngine({ store });
    engine.registerAction('noop', () => undefined);

    // Before loading: workflow is not in memory
    expect(engine.getWorkflow('wf-loaded')).toBeNull();

    const count = await engine.loadFromStore();
    expect(count).toBe(1);
    expect(engine.getWorkflow('wf-loaded')).not.toBeNull();
  });

  // ---------------------------------------------------------------- run logs
  it('keeps workflow run logs for the admin viewer', async () => {
    const engine = new WorkflowEngine();
    engine.registerAction('noop', () => undefined);
    engine.registerWorkflow({
      id: 'wf-logs',
      name: 'Log test',
      trigger: { event: 'user.registered' },
      steps: [{ id: 's1', action: 'noop' }],
    });

    const wf = engine.getWorkflow('wf-logs')!;
    await engine.runWorkflow(wf, triggerEvent());
    await engine.runWorkflow(wf, triggerEvent());

    const logs = engine.listRunLogs('wf-logs');
    expect(logs).toHaveLength(2);
    expect(logs[0]?.triggerEventId).toBe('evt-1');
  });

  // ---------------------------------------------------------------- event binding
  it('binds to a Rota Events consumer', async () => {
    const engine = new WorkflowEngine();
    const tracked: string[] = [];
    engine.registerAction('track.signup', (ctx) => {
      tracked.push(ctx.event.payload['userId'] as string);
    });
    engine.registerWorkflow({
      id: 'wf-events',
      name: 'Event binding test',
      trigger: { event: 'user.registered' },
      steps: [{ id: 's1', action: 'track.signup' }],
    });

    const store = new InMemoryEventStore();
    const publisher = new EventPublisher(store);
    const consumer = new EventConsumer(store);
    engine.bindToConsumer(consumer);

    await publisher.publish({
      type: 'user.registered',
      source: 'rota-identity',
      payload: { userId: 'u9' },
    });
    await consumer.processPending();

    expect(tracked).toEqual(['u9']);
    expect(engine.listRunLogs()).toHaveLength(1);
  });
});
