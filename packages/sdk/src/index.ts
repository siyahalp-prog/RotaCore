import { createLogger, type Logger } from '@rota-core/logger';
import {
  EventConsumer,
  EventPublisher,
  InMemoryEventStore,
  type EventStore,
} from '@rota-core/events';
import {
  InMemoryNotificationStore,
  NotificationService,
  ConsoleEmailProvider,
  registerNotificationEventHandlers,
  type NotificationStore,
  type EmailProvider,
} from '@rota-core/notifications';
import {
  AnalyticsService,
  InMemoryAnalyticsStore,
  type AnalyticsStore,
} from '@rota-core/analytics';
import {
  InMemorySearchAdapter,
  InMemorySearchLogStore,
  SearchService,
  type SearchAdapter,
} from '@rota-core/search';
import {
  AlertManager,
  ConsoleAlertChannel,
  ErrorCollector,
  HealthCheckRegistry,
  LatencyTracker,
  LogIngestion,
} from '@rota-core/monitoring';
import { FeatureFlagClient, InMemoryFlagStore, type FlagStore } from '@rota-core/feature-flags';
import { WorkflowEngine } from '@rota-core/workflows';

export type RotaCoreOptions = {
  serviceName?: string;
  logger?: Logger;
  /** Adapters default to in-memory implementations; pass PostgreSQL adapters in production. */
  eventStore?: EventStore;
  notificationStore?: NotificationStore;
  analyticsStore?: AnalyticsStore;
  searchAdapter?: SearchAdapter;
  flagStore?: FlagStore;
  emailProvider?: EmailProvider;
  resolveEmail?: (userId: string) => Promise<string | null>;
  /** Wire default ecosystem event → notification handlers. Default: true. */
  registerDefaultNotificationHandlers?: boolean;
};

export type RotaCore = ReturnType<typeof createRotaCore>;

/**
 * One-call setup of the whole Rota Core platform layer.
 * Products (RotaGlobal, Rota Identity, Falcion, ...) use this facade instead of
 * wiring every package manually.
 */
export function createRotaCore(options: RotaCoreOptions = {}) {
  const logger = options.logger ?? createLogger({ name: options.serviceName ?? 'rota-core' });

  const eventStore = options.eventStore ?? new InMemoryEventStore();
  const publisher = new EventPublisher(eventStore);
  const consumer = new EventConsumer(eventStore, { logger });

  const notificationStore = options.notificationStore ?? new InMemoryNotificationStore();
  const notifications = new NotificationService(notificationStore, {
    emailProvider: options.emailProvider ?? new ConsoleEmailProvider(logger),
    logger,
    ...(options.resolveEmail !== undefined ? { resolveEmail: options.resolveEmail } : {}),
  });

  const analytics = new AnalyticsService(options.analyticsStore ?? new InMemoryAnalyticsStore());
  const search = new SearchService(
    options.searchAdapter ?? new InMemorySearchAdapter(),
    new InMemorySearchLogStore(),
  );

  const health = new HealthCheckRegistry();
  const errors = new ErrorCollector();
  const latency = new LatencyTracker();
  const logIngestion = new LogIngestion();
  const alerts = new AlertManager(errors);
  alerts.addChannel(new ConsoleAlertChannel(logger));

  const flags = new FeatureFlagClient(options.flagStore ?? new InMemoryFlagStore());
  const workflows = new WorkflowEngine({ logger });

  if (options.registerDefaultNotificationHandlers !== false) {
    registerNotificationEventHandlers(consumer, notifications);
  }

  return {
    logger,
    events: { store: eventStore, publisher, consumer },
    notifications,
    analytics,
    search,
    monitoring: { health, errors, latency, logIngestion, alerts },
    flags,
    workflows,
  };
}

// Re-export module surfaces so products can depend on @rota-core/sdk alone.
export * from '@rota-core/types';
export * from '@rota-core/events';
export * from '@rota-core/notifications';
export * from '@rota-core/analytics';
export * from '@rota-core/search';
export * from '@rota-core/monitoring';
export * from '@rota-core/feature-flags';
export * from '@rota-core/workflows';
