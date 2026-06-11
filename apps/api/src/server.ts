import { z } from 'zod';
import { loadEnv, baseEnvSchema } from '@rota-core/config';
import { createLogger } from '@rota-core/logger';
import { createRotaCore } from '@rota-core/sdk';
import { buildApp } from './app.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const env = loadEnv(
  baseEnvSchema.extend({
    API_PORT: z.coerce.number().int().default(3000),
    API_HOST: z.string().default('0.0.0.0'),
  }),
);

// ---------------------------------------------------------------------------
// Core + App
// ---------------------------------------------------------------------------

const logger = createLogger({ name: 'rota-core-api', level: env.LOG_LEVEL });
const core = createRotaCore({ serviceName: 'rota-core-api', logger });

core.monitoring.health.register('api', () => ({ ok: true }));

const app = buildApp(core, {
  ...(env.ADMIN_TOKEN !== undefined ? { adminToken: env.ADMIN_TOKEN } : {}),
  ...(env.CORS_ORIGIN !== undefined ? { corsOrigin: env.CORS_ORIGIN } : {}),
  logger,
});

// ---------------------------------------------------------------------------
// Startup initialisation
// ---------------------------------------------------------------------------

/**
 * Recover stuck events and load persisted workflow definitions before
 * beginning the event processing loop.
 * This must complete before polling starts to avoid processing events
 * that were stuck from a previous crashed run.
 */
await core.initialize();

// ---------------------------------------------------------------------------
// Background event processing loop (simple in-process worker)
// ---------------------------------------------------------------------------

const pollInterval = setInterval(() => {
  core.events.consumer.processPending().catch((error: unknown) => {
    logger.error('Event processing failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}, 1000);
pollInterval.unref();

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app
  .listen({ port: env.API_PORT, host: env.API_HOST })
  .then((address) => {
    logger.info(`Rota Core API listening at ${address}`, {
      adminProtected: env.ADMIN_TOKEN !== undefined,
      corsOrigin: env.CORS_ORIGIN ?? '*',
    });
  })
  .catch((error: unknown) => {
    logger.error('Failed to start API', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

/**
 * Handle SIGTERM (sent by Kubernetes / Docker on pod/container stop)
 * and SIGINT (Ctrl+C in development).
 *
 * Sequence:
 * 1. Stop accepting new connections (Fastify closes the HTTP server).
 * 2. Wait for in-flight requests to complete (Fastify default: 10 s).
 * 3. Stop the background event-processing loop.
 * 4. Exit cleanly with code 0.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal} — shutting down gracefully`);
  clearInterval(pollInterval);
  try {
    await app.close();
    logger.info('Server closed, exiting');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
