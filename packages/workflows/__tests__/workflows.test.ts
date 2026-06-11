import { describe, expect, it } from 'vitest';
import { EventConsumer, EventPublisher, InMemoryEventStore } from '@rota-core/events';
import { WorkflowEngine } from '../src/index.js';
import type { RotaEvent } from '@rota-core/types';

function triggerEvent(type = 'user.registered'): RotaEvent {
  return {
    id: 'evt-1',
    type,
    source: 'rota-identity',
    payload: { userId: 'u1', email: 'a@rota.app' },
    createdAt: new Date(),
  };
}

describe('Rota Workflow Engine', () => {
  it('validates workflow definitions', () => {
    const engine = new WorkflowEngine();
    expect(() =>
      engine.registerWorkflow({ id: '', name: '', trigger: { event: '' }, steps: [] }),
    ).toThrowError();
  });

  it('rejects workflows referencing unknown actions', () => {
    const engine = new WorkflowEngine();
    expect(() =>
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'Test',
        trigger: { event: 'user.registered' },
        steps: [{ id: 's1', action: 'does.not.exist' }],
      }),
    ).toThrowError(/Unknown action/);
  });

  it('runs all steps in order with merged input', async () => {
    const engine = new WorkflowEngine();
    const calls: string[] = [];
    engine.registerAction('send.welcome.email', (_ctx, input) => {
      calls.push(`email:${input['email']}`);
    });
    engine.registerAction('create.forum.profile', (_ctx, input) => {
      calls.push(`forum:${input['userId']}`);
      return { profileId: 'p1' };
    });
    engine.registerWorkflow({
      id: 'onboarding',
      name: 'User onboarding',
      trigger: { event: 'user.registered' },
      steps: [
        { id: 's1', action: 'send.welcome.email' },
        { id: 's2', action: 'create.forum.profile' },
      ],
    });

    const [run] = await engine.handleEvent(triggerEvent());
    expect(calls).toEqual(['email:a@rota.app', 'forum:u1']);
    expect(run?.status).toBe('completed');
    expect(run?.steps[1]?.output).toEqual({ profileId: 'p1' });
  });

  it('retries failing steps', async () => {
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

    const [run] = await engine.handleEvent(triggerEvent());
    expect(run?.status).toBe('completed');
    expect(run?.steps[0]?.attempts).toBe(3);
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
    const [abortRun] = await engine.handleEvent(triggerEvent());
    expect(abortRun?.status).toBe('failed');
    expect(abortRun?.steps[1]?.status).toBe('skipped');
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
    const [continueRun] = await engine.handleEvent(triggerEvent('post.created'));
    expect(continueRun?.status).toBe('partial');
    expect(calls).toEqual(['after']);
  });

  it('keeps workflow run logs for the admin viewer', async () => {
    const engine = new WorkflowEngine();
    engine.registerAction('noop', () => undefined);
    engine.registerWorkflow({
      id: 'wf-logs',
      name: 'Log test',
      trigger: { event: 'user.registered' },
      steps: [{ id: 's1', action: 'noop' }],
    });

    await engine.handleEvent(triggerEvent());
    await engine.handleEvent(triggerEvent());

    const logs = engine.listRunLogs('wf-logs');
    expect(logs).toHaveLength(2);
    expect(logs[0]?.triggerEventId).toBe('evt-1');
  });

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
