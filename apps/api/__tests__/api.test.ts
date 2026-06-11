import { describe, expect, it } from 'vitest';
import { noopLogger } from '@rota-core/logger';
import { createRotaCore } from '@rota-core/sdk';
import { buildApp } from '../src/app.js';

function testApp() {
  const core = createRotaCore({ serviceName: 'test-api', logger: noopLogger });
  core.monitoring.health.register('self', () => ({ ok: true }));
  return { core, app: buildApp(core) };
}

describe('Rota Core API', () => {
  it('GET /health returns health report', async () => {
    const { app } = testApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, data: { status: 'healthy' } });
  });

  it('POST /events publishes events and GET /admin/events lists them', async () => {
    const { app } = testApp();
    const publish = await app.inject({
      method: 'POST',
      url: '/events',
      payload: { type: 'user.registered', source: 'rota-identity', payload: { x: 1 } },
    });
    expect(publish.statusCode).toBe(200);
    expect(publish.json().data.type).toBe('user.registered');

    const list = await app.inject({ method: 'GET', url: '/admin/events?type=user.registered' });
    expect(list.json().data).toHaveLength(1);
  });

  it('POST /events with invalid payload returns the shared error envelope', async () => {
    const { app } = testApp();
    const response = await app.inject({
      method: 'POST',
      url: '/events',
      payload: { type: '!!!', source: '' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('POST /track records analytics and GET /track.js serves the script', async () => {
    const { app } = testApp();
    const track = await app.inject({
      method: 'POST',
      url: '/track',
      payload: { eventName: 'page_view', sessionId: 's1', visitorId: 'v1', pageUrl: '/home' },
    });
    expect(track.json().data.tracked).toBe(true);

    const script = await app.inject({ method: 'GET', url: '/track.js' });
    expect(script.headers['content-type']).toContain('javascript');
    expect(script.body).toContain('rota_visitor_id');
  });

  it('GET /search returns search results', async () => {
    const { core, app } = testApp();
    await core.search.indexDocument({
      id: 's1',
      type: 'scholarship',
      title: 'DAAD Scholarship',
      content: 'Study in Germany',
      tags: ['germany'],
      source: 'rotaglobal',
    });
    const response = await app.inject({ method: 'GET', url: '/search?q=daad' });
    expect(response.json().data.total).toBe(1);
  });

  it('GET /flags/:key evaluates flags', async () => {
    const { core, app } = testApp();
    await core.flags.upsertFlag({ key: 'beta-ui', enabled: true, allowedRoles: ['beta'] });

    const on = await app.inject({ method: 'GET', url: '/flags/beta-ui?userId=u1&roles=beta' });
    expect(on.json().data.enabled).toBe(true);

    const off = await app.inject({ method: 'GET', url: '/flags/beta-ui?userId=u2&roles=member' });
    expect(off.json().data.enabled).toBe(false);
  });
});
