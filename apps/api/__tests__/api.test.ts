import { describe, expect, it } from 'vitest';
import { noopLogger } from '@rota-core/logger';
import { createRotaCore } from '@rota-core/sdk';
import { buildApp } from '../src/app.js';

/** App with no admin token (dev mode — admin routes open, for most tests). */
function testApp() {
  const core = createRotaCore({ serviceName: 'test-api', logger: noopLogger });
  core.monitoring.health.register('self', () => ({ ok: true }));
  return { core, app: buildApp(core) };
}

/** App with admin token protection enabled. */
function protectedApp() {
  const core = createRotaCore({ serviceName: 'test-api', logger: noopLogger });
  core.monitoring.health.register('self', () => ({ ok: true }));
  return { core, app: buildApp(core, { adminToken: 'super-secret-test-token-1234567890' }) };
}

describe('Rota Core API', () => {
  // ---------------------------------------------------------------- health
  it('GET /health returns health report', async () => {
    const { app } = testApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, data: { status: 'healthy' } });
  });

  // ---------------------------------------------------------------- events
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

  it('POST /events with no body returns 400', async () => {
    const { app } = testApp();
    const response = await app.inject({ method: 'POST', url: '/events' });
    expect(response.statusCode).toBe(400);
    expect(response.json().ok).toBe(false);
  });

  // ---------------------------------------------------------------- errors
  it('POST /errors with valid body records an error', async () => {
    const { app } = testApp();
    const response = await app.inject({
      method: 'POST',
      url: '/errors',
      payload: { service: 'rota-identity', message: 'DB connection failed' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.id).toBeTruthy();
  });

  it('POST /errors rejects oversized fields', async () => {
    const { app } = testApp();
    const response = await app.inject({
      method: 'POST',
      url: '/errors',
      payload: { service: 'x'.repeat(201), message: 'too long service name' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('POST /errors with no body returns 400', async () => {
    const { app } = testApp();
    const response = await app.inject({ method: 'POST', url: '/errors' });
    expect(response.statusCode).toBe(400);
  });

  // ---------------------------------------------------------------- analytics
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

  it('GET /track.js includes Access-Control-Allow-Origin header', async () => {
    const { app } = testApp();
    const response = await app.inject({ method: 'GET', url: '/track.js' });
    expect(response.headers['access-control-allow-origin']).toBeDefined();
  });

  it('OPTIONS /track returns CORS preflight headers', async () => {
    const { app } = testApp();
    const response = await app.inject({ method: 'OPTIONS', url: '/track' });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBeDefined();
    expect(response.headers['access-control-allow-methods']).toContain('POST');
  });

  // ---------------------------------------------------------------- search
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

  // ---------------------------------------------------------------- flags
  it('GET /flags/:key evaluates flags', async () => {
    const { core, app } = testApp();
    await core.flags.upsertFlag({ key: 'beta-ui', enabled: true, allowedRoles: ['beta'] });

    const on = await app.inject({ method: 'GET', url: '/flags/beta-ui?userId=u1&roles=beta' });
    expect(on.json().data.enabled).toBe(true);

    const off = await app.inject({ method: 'GET', url: '/flags/beta-ui?userId=u2&roles=member' });
    expect(off.json().data.enabled).toBe(false);
  });

  // ---------------------------------------------------------------- admin auth
  it('admin routes return 401 when token is missing and ADMIN_TOKEN is set', async () => {
    const { app } = protectedApp();

    const noToken = await app.inject({ method: 'GET', url: '/admin/dashboard' });
    expect(noToken.statusCode).toBe(401);
    expect(noToken.json()).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
  });

  it('admin routes return 401 for wrong token', async () => {
    const { app } = protectedApp();

    const wrongToken = await app.inject({
      method: 'GET',
      url: '/admin/dashboard',
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(wrongToken.statusCode).toBe(401);
  });

  it('admin routes are accessible with correct bearer token', async () => {
    const { app } = protectedApp();

    const goodToken = await app.inject({
      method: 'GET',
      url: '/admin/dashboard',
      headers: { Authorization: 'Bearer super-secret-test-token-1234567890' },
    });
    expect(goodToken.statusCode).toBe(200);
    expect(goodToken.json().ok).toBe(true);
  });

  it('admin routes are accessible without token when ADMIN_TOKEN is not set (dev mode)', async () => {
    const { app } = testApp(); // no adminToken

    const response = await app.inject({ method: 'GET', url: '/admin/dashboard' });
    expect(response.statusCode).toBe(200);
  });
});
