import { describe, expect, it } from 'vitest';
import {
  AlertManager,
  ConsoleAlertChannel,
  ErrorCollector,
  HealthCheckRegistry,
  LatencyTracker,
  LogIngestion,
  buildServiceDashboard,
} from '../src/index.js';
import type { Alert, AlertChannel } from '../src/index.js';

class CapturingAlertChannel implements AlertChannel {
  readonly name = 'capturing';
  readonly sent: Alert[] = [];
  async send(alert: Alert): Promise<void> {
    this.sent.push(alert);
  }
}

describe('Rota Monitoring', () => {
  it('reports healthy when all checks pass', async () => {
    const registry = new HealthCheckRegistry()
      .register('database', () => ({ ok: true }))
      .register('cache', () => ({ ok: true }));
    const report = await registry.run();
    expect(report.status).toBe('healthy');
    expect(report.checks).toHaveLength(2);
  });

  it('reports degraded when some checks fail (including thrown errors)', async () => {
    const registry = new HealthCheckRegistry()
      .register('database', () => ({ ok: true }))
      .register('search', () => {
        throw new Error('connection refused');
      });
    const report = await registry.run();
    expect(report.status).toBe('degraded');
    expect(report.checks.find((c) => c.name === 'search')?.message).toBe('connection refused');
  });

  it('collects and groups errors by fingerprint', () => {
    const collector = new ErrorCollector();
    collector.captureException('api', new Error('db timeout'));
    collector.captureException('api', new Error('db timeout'));
    collector.captureException('worker', new Error('queue full'));

    const groups = collector.countByFingerprint();
    expect(groups[0]).toMatchObject({ count: 2, lastMessage: 'db timeout' });
    expect(collector.list({ service: 'worker' })).toHaveLength(1);
  });

  it('ingests and queries logs', () => {
    const ingestion = new LogIngestion();
    ingestion.ingest({ service: 'api', level: 'error', message: 'boom' });
    ingestion.ingest({ service: 'api', level: 'info', message: 'ok' });
    expect(ingestion.query({ level: 'error' })).toHaveLength(1);
    expect(ingestion.query({ service: 'api' })).toHaveLength(2);
  });

  it('detects slow endpoints via p95', () => {
    const tracker = new LatencyTracker();
    for (let i = 0; i < 20; i++) tracker.record('GET /fast', 30);
    for (let i = 0; i < 20; i++) tracker.record('GET /slow', 900);

    const slow = tracker.slowEndpoints(500);
    expect(slow).toHaveLength(1);
    expect(slow[0]?.endpoint).toBe('GET /slow');
  });

  it('triggers alerts when error threshold is exceeded and respects cooldown', async () => {
    const collector = new ErrorCollector();
    const manager = new AlertManager(collector);
    const channel = new CapturingAlertChannel();
    manager
      .addRule({ name: 'api-errors', severity: 'critical', errorThreshold: 3, windowMs: 60_000 })
      .addChannel(channel);

    collector.captureException('api', new Error('e1'));
    collector.captureException('api', new Error('e2'));
    expect(await manager.evaluate()).toHaveLength(0);

    collector.captureException('api', new Error('e3'));
    const triggered = await manager.evaluate();
    expect(triggered).toHaveLength(1);
    expect(channel.sent).toHaveLength(1);

    // Cooldown prevents immediate re-alerting
    expect(await manager.evaluate()).toHaveLength(0);
  });

  it('builds the service dashboard', async () => {
    const health = new HealthCheckRegistry().register('db', () => ({ ok: true }));
    const errors = new ErrorCollector();
    const latency = new LatencyTracker();
    const alerts = new AlertManager(errors);
    alerts.addChannel(new ConsoleAlertChannel());

    errors.captureException('api', new Error('oops'));
    latency.record('GET /x', 800);

    const dashboard = await buildServiceDashboard({ health, errors, latency, alerts });
    expect(dashboard.health.status).toBe('healthy');
    expect(dashboard.topErrors).toHaveLength(1);
    expect(dashboard.slowEndpoints).toHaveLength(1);
  });
});
