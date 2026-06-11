import { z } from 'zod';
import { loadEnv, baseEnvSchema } from '@rota-core/config';
import { createLogger } from '@rota-core/logger';
import { createRotaCore } from '@rota-core/sdk';
import { buildApp } from './app.js';

const env = loadEnv(
  baseEnvSchema.extend({
    API_PORT: z.coerce.number().int().default(3000),
    API_HOST: z.string().default('0.0.0.0'),
  }),
);

const logger = createLogger({ name: 'rota-core-api', level: env.LOG_LEVEL });
const core = createRotaCore({ serviceName: 'rota-core-api', logger });

core.monitoring.health.register('api', () => ({ ok: true }));

const app = buildApp(core);

// Background event processing loop (simple in-process worker)
const pollInterval = setInterval(() => {
  core.events.consumer.processPending().catch((error: unknown) => {
    logger.error('Event processing failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}, 1000);
pollInterval.unref();

app
  .listen({ port: env.API_PORT, host: env.API_HOST })
  .then((address) => logger.info(`Rota Core API listening at ${address}`))
  .catch((error: unknown) => {
    logger.error('Failed to start API', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
