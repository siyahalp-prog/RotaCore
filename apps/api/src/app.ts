import Fastify, { type FastifyInstance } from 'fastify';
import { ok, toApiFailure, RotaError } from '@rota-core/core';
import {
  buildTrackingScript,
  createRotaCore,
  buildServiceDashboard,
  type RotaCore,
} from '@rota-core/sdk';

/**
 * Rota Core API.
 * Exposes the platform modules over HTTP for products and the Admin Hub.
 * Uses in-memory adapters by default; swap in PostgreSQL adapters via `core`.
 */
export function buildApp(
  core: RotaCore = createRotaCore({ serviceName: 'rota-core-api' }),
): FastifyInstance {
  const app = Fastify({ logger: false });

  // Track API latency for slow endpoint detection
  app.addHook('onResponse', (request, reply, done) => {
    core.monitoring.latency.record(
      `${request.method} ${request.routeOptions.url ?? request.url}`,
      reply.elapsedTime,
    );
    done();
  });

  app.setErrorHandler((error, _request, reply) => {
    core.monitoring.errors.captureException('rota-core-api', error);
    const statusCode = error instanceof RotaError ? error.statusCode : 500;
    void reply.status(statusCode).send(toApiFailure(error));
  });

  // ----------------------------------------------------------- monitoring
  app.get('/health', async () => ok(await core.monitoring.health.run()));
  app.get('/admin/dashboard', async () =>
    ok(
      await buildServiceDashboard({
        health: core.monitoring.health,
        errors: core.monitoring.errors,
        latency: core.monitoring.latency,
        alerts: core.monitoring.alerts,
      }),
    ),
  );
  app.post('/errors', async (request) => {
    const body = request.body as { service?: string; message?: string; stack?: string };
    const record = core.monitoring.errors.capture({
      service: body.service ?? 'unknown',
      message: body.message ?? 'unknown error',
      ...(body.stack !== undefined ? { stack: body.stack } : {}),
    });
    return ok({ id: record.id });
  });

  // ---------------------------------------------------------------- events
  app.post('/events', async (request) => {
    const event = await core.events.publisher.publish(
      request.body as Parameters<typeof core.events.publisher.publish>[0],
    );
    return ok(event);
  });
  app.get('/admin/events', async (request) => {
    const { type, status } = request.query as { type?: string; status?: string };
    return ok(
      await core.events.store.list({
        ...(type !== undefined ? { type } : {}),
        ...(status !== undefined ? { status: status as never } : {}),
      }),
    );
  });

  // ------------------------------------------------------------- analytics
  app.post('/track', async (request) => {
    const event = await core.analytics.track(
      request.body as Parameters<typeof core.analytics.track>[0],
    );
    return ok({ tracked: event !== null });
  });
  app.get('/track.js', async (_request, reply) => {
    return reply.type('application/javascript').send(buildTrackingScript('/track'));
  });

  // ---------------------------------------------------------------- search
  app.get('/search', async (request) => {
    const { q, type } = request.query as { q?: string; type?: string };
    const result = await core.search.search(q ?? '', {
      ...(type !== undefined ? { type } : {}),
    });
    return ok(result);
  });

  // ----------------------------------------------------------------- flags
  app.get('/flags/:key', async (request) => {
    const { key } = request.params as { key: string };
    const { userId, roles } = request.query as { userId?: string; roles?: string };
    const enabled = await core.flags.isEnabled(key, {
      ...(userId !== undefined ? { userId } : {}),
      ...(roles !== undefined ? { roles: roles.split(',') } : {}),
    });
    return ok({ key, enabled });
  });

  return app;
}
