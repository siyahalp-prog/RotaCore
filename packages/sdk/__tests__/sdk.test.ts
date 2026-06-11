import { describe, expect, it } from 'vitest';
import { createRotaCore } from '../src/index.js';
import { noopLogger } from '@rota-core/logger';

describe('Rota Core SDK', () => {
  it('wires all modules together end-to-end', async () => {
    const rota = createRotaCore({ serviceName: 'test', logger: noopLogger });

    // Workflow: track signup analytics when a user registers
    rota.workflows.registerAction('track.signup', async (ctx) => {
      await rota.analytics.track({
        eventName: 'signup',
        sessionId: 'srv',
        visitorId: (ctx.event.actorId ?? 'unknown') as string,
        userId: ctx.event.actorId as string,
      });
    });
    rota.workflows.registerWorkflow({
      id: 'signup-analytics',
      name: 'Track signups',
      trigger: { event: 'user.registered' },
      steps: [{ id: 's1', action: 'track.signup' }],
    });
    rota.workflows.bindToConsumer(rota.events.consumer);

    // Publish the canonical ecosystem event
    await rota.events.publisher.publish({
      type: 'user.registered',
      source: 'rota-identity',
      actorId: 'user-1',
      payload: { name: 'Ada' },
    });
    await rota.events.consumer.processPending();

    // Default handler created a welcome notification
    const notifications = await rota.notifications.listForUser('user-1');
    expect(notifications.length).toBeGreaterThan(0);

    // Workflow tracked the signup in analytics
    const counts = await rota.analytics.eventsByName(new Date(0), new Date('2100-01-01'));
    expect(counts.find((c) => c.name === 'signup')?.count).toBe(1);

    // Search + flags + monitoring work through the same facade
    await rota.search.indexDocument({
      id: 'u1',
      type: 'university',
      title: 'TU Munich',
      content: 'Engineering university in Germany',
      tags: ['germany'],
      source: 'rotaglobal',
    });
    expect((await rota.search.search('germany')).total).toBe(1);

    await rota.flags.upsertFlag({ key: 'new-dashboard', enabled: true });
    expect(await rota.flags.isEnabled('new-dashboard', { userId: 'user-1' })).toBe(true);

    rota.monitoring.health.register('self', () => ({ ok: true }));
    expect((await rota.monitoring.health.run()).status).toBe('healthy');
  });
});
