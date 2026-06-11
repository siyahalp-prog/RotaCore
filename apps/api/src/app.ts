import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ok,
  toApiFailure,
  RotaError,
  ValidationError,
  UnauthorizedError,
  RateLimitError,
} from '@rota-core/core';
import {
  buildTrackingScript,
  createRotaCore,
  buildServiceDashboard,
  type RotaCore,
} from '@rota-core/sdk';
import type { Logger } from '@rota-core/logger';

// ---------------------------------------------------------------------------
// App options
// ---------------------------------------------------------------------------

export type AppOptions = {
  /**
   * Bearer token required to call /admin/* routes.
   * When undefined (local dev default), admin routes are unauthenticated.
   * Always set this in production via the ADMIN_TOKEN environment variable.
   */
  adminToken?: string;
  /**
   * Value for the Access-Control-Allow-Origin header on browser-facing
   * endpoints (/track, /track.js). Defaults to '*'. In production, set
   * this to your specific product origin(s).
   */
  corsOrigin?: string;
  /** Structured logger — if provided, request/response logs are emitted. */
  logger?: Logger;
};

// ---------------------------------------------------------------------------
// Simple in-memory token-bucket rate limiter (no external dependency)
// ---------------------------------------------------------------------------

type RateLimitBucket = { count: number; resetAt: number };
const rateLimitStore = new Map<string, RateLimitBucket>();

/**
 * Returns true if the request is within the allowed rate.
 * Uses a fixed-window counter keyed on `ip:endpoint`.
 */
function allowRequest(ip: string, endpoint: string, limit: number, windowMs: number): boolean {
  const key = `${ip}:${endpoint}`;
  const now = Date.now();
  const bucket = rateLimitStore.get(key);

  if (bucket === undefined || bucket.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  bucket.count += 1;
  return bucket.count <= limit;
}

/** Periodically prune expired buckets to prevent unbounded memory growth. */
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitStore) {
    if (bucket.resetAt <= now) rateLimitStore.delete(key);
  }
}, 60_000).unref();

// ---------------------------------------------------------------------------
// Validation schemas for HTTP boundary
// ---------------------------------------------------------------------------

const captureErrorSchema = z.object({
  service: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  /** Stack trace — large but bounded. */
  stack: z.string().max(10_000).optional(),
  /** Structured context — object only, keys/values bounded. */
  context: z.record(z.string().max(100), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

/**
 * Rota Core API.
 * Exposes the platform modules over HTTP for products and the Admin Hub.
 * Uses in-memory adapters by default; swap in PostgreSQL adapters via `core`.
 */
export function buildApp(
  core: RotaCore = createRotaCore({ serviceName: 'rota-core-api' }),
  options: AppOptions = {},
): FastifyInstance {
  const app = Fastify({ logger: false });
  const appLogger = options.logger;
  const corsOrigin = options.corsOrigin ?? '*';

  // --------------------------------------------------------- request logging
  // Emit structured request/response log lines via @rota-core/logger so that
  // all PII redaction rules (email, token, etc.) are applied automatically.
  if (appLogger !== undefined) {
    app.addHook('onRequest', (request, _reply, done) => {
      appLogger.info('Incoming request', {
        method: request.method,
        url: request.url,
        ip: request.ip,
      });
      done();
    });

    app.addHook('onResponse', (request, reply, done) => {
      appLogger.info('Request completed', {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      });
      done();
    });

    app.addHook('onError', (request, _reply, error, done) => {
      appLogger.error('Request error', {
        method: request.method,
        url: request.url,
        error: error.message,
      });
      done();
    });
  }

  // --------------------------------------------------------- admin auth
  // All /admin/* routes require a valid Bearer token when ADMIN_TOKEN is set.
  // In local development (ADMIN_TOKEN not set) the check is skipped so
  // developers can use the admin endpoints without extra config.
  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/admin')) return;
    if (options.adminToken === undefined) return; // dev mode — no token required

    const authHeader = request.headers.authorization;
    const token =
      authHeader !== undefined && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : undefined;

    if (token === undefined || token !== options.adminToken) {
      return reply
        .status(401)
        .send(toApiFailure(new UnauthorizedError('Invalid or missing admin token')));
    }
  });

  // --------------------------------------------------------- latency tracking
  app.addHook('onResponse', (request, reply, done) => {
    core.monitoring.latency.record(
      `${request.method} ${request.routeOptions.url ?? request.url}`,
      reply.elapsedTime,
    );
    done();
  });

  // --------------------------------------------------------- error handler
  app.setErrorHandler((error, _request, reply) => {
    core.monitoring.errors.captureException('rota-core-api', error);
    const statusCode = error instanceof RotaError ? error.statusCode : 500;
    void reply.status(statusCode).send(toApiFailure(error));
  });

  // --------------------------------------------------------- CORS for browser endpoints
  // /track and /track.js are called cross-origin by embedded tracking scripts.
  app.addHook('onSend', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (path === '/track' || path === '/track.js') {
      void reply.header('Access-Control-Allow-Origin', corsOrigin);
      void reply.header('Vary', 'Origin');
    }
  });

  // OPTIONS preflight for /track (browsers send this before cross-origin POST)
  app.options('/track', async (_request, reply) => {
    void reply.header('Access-Control-Allow-Origin', corsOrigin);
    void reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    void reply.header('Access-Control-Allow-Headers', 'Content-Type');
    return reply.status(204).send();
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

  /**
   * POST /errors
   * Accepts error reports from Rota services. Validated and size-bounded
   * to prevent pollution of the error fingerprint index.
   * Rate-limited: 20 reports per minute per IP.
   */
  app.post('/errors', async (request) => {
    if (!allowRequest(request.ip ?? 'unknown', 'errors', 20, 60_000)) {
      throw new RateLimitError();
    }
    if (request.body === null || request.body === undefined) {
      throw new ValidationError('Request body is required');
    }
    const parsed = captureErrorSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid error report', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const { service, message, stack, context } = parsed.data;
    const record = core.monitoring.errors.capture({
      service,
      message,
      ...(stack !== undefined ? { stack } : {}),
      ...(context !== undefined ? { context } : {}),
    });
    return ok({ id: record.id });
  });

  // ---------------------------------------------------------------- events
  /**
   * POST /events
   * Publishes a new event. Validation is performed inside EventPublisher (Zod).
   * Rate-limited: 60 per minute per IP.
   */
  app.post('/events', async (request) => {
    if (!allowRequest(request.ip ?? 'unknown', 'events', 60, 60_000)) {
      throw new RateLimitError();
    }
    if (request.body === null || request.body === undefined) {
      throw new ValidationError('Request body is required');
    }
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
  /**
   * POST /track
   * Records an analytics event. Rate-limited: 60 per minute per IP.
   * CORS headers are added by the onSend hook above.
   */
  app.post('/track', async (request) => {
    if (!allowRequest(request.ip ?? 'unknown', 'track', 60, 60_000)) {
      throw new RateLimitError();
    }
    if (request.body === null || request.body === undefined) {
      throw new ValidationError('Request body is required');
    }
    const event = await core.analytics.track(
      request.body as Parameters<typeof core.analytics.track>[0],
    );
    return ok({ tracked: event !== null });
  });

  /**
   * GET /track.js
   * Serves the lightweight browser tracking script.
   * CORS headers are added by the onSend hook above.
   */
  app.get('/track.js', async (_request, reply) => {
    return reply.type('application/javascript').send(buildTrackingScript('/track'));
  });

  // ---------------------------------------------------------------- search
  /**
   * GET /search
   * Full-text search. Rate-limited: 60 per minute per IP.
   * Query is capped at 500 characters before reaching the DB tsvector parser.
   */
  app.get('/search', async (request) => {
    if (!allowRequest(request.ip ?? 'unknown', 'search', 60, 60_000)) {
      throw new RateLimitError();
    }
    const { q, type } = request.query as { q?: string; type?: string };
    const query = (q ?? '').slice(0, 500);
    const result = await core.search.search(query, {
      ...(type !== undefined ? { type } : {}),
    });
    return ok(result);
  });

  // ----------------------------------------------------------------- flags
  app.get('/flags/:key', async (request) => {
    const { key } = request.params as { key: string };
    const { userId, roles } = request.query as { userId?: string; roles?: string };
    // Cap roles list to prevent excessively large Set allocations in evaluateFlag
    const roleList =
      roles !== undefined ? roles.split(',').slice(0, 20).map((r) => r.trim()) : undefined;
    const enabled = await core.flags.isEnabled(key, {
      ...(userId !== undefined ? { userId } : {}),
      ...(roleList !== undefined && roleList.length > 0 ? { roles: roleList } : {}),
    });
    return ok({ key, enabled });
  });

  return app;
}
