import type { HealthCheckRegistry, HealthReport } from './health.js';
import type { ErrorCollector } from './errors.js';
import type { LatencyTracker, EndpointStats } from './latency.js';
import type { Alert, AlertManager } from './alerts.js';

export type ServiceDashboard = {
  health: HealthReport;
  topErrors: { fingerprint: string; count: number; lastMessage: string }[];
  slowEndpoints: EndpointStats[];
  recentAlerts: Alert[];
};

/** Aggregated service status view for the Admin Hub. */
export async function buildServiceDashboard(deps: {
  health: HealthCheckRegistry;
  errors: ErrorCollector;
  latency: LatencyTracker;
  alerts: AlertManager;
  slowThresholdMs?: number;
}): Promise<ServiceDashboard> {
  return {
    health: await deps.health.run(),
    topErrors: deps.errors.countByFingerprint().slice(0, 10),
    slowEndpoints: deps.latency.slowEndpoints(deps.slowThresholdMs ?? 500),
    recentAlerts: deps.alerts.history.slice(-10).reverse(),
  };
}
