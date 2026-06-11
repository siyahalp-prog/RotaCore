import { systemClock, type Clock } from '@rota-core/core';
import { noopLogger, type Logger } from '@rota-core/logger';
import type { ErrorCollector } from './errors.js';

export type Alert = {
  rule: string;
  severity: 'warning' | 'critical';
  message: string;
  context?: Record<string, unknown> | undefined;
  triggeredAt: Date;
};

/** Delivery boundary for alerts: console, Discord webhook, email, ... */
export type AlertChannel = {
  readonly name: string;
  send(alert: Alert): Promise<void>;
};

export class ConsoleAlertChannel implements AlertChannel {
  readonly name = 'console';
  constructor(private readonly logger: Logger = noopLogger) {}

  async send(alert: Alert): Promise<void> {
    this.logger.error(`ALERT [${alert.severity}] ${alert.rule}: ${alert.message}`, alert.context);
  }
}

/**
 * Webhook alert channel (Discord-compatible payload).
 * The webhook URL comes from configuration; it is never logged.
 */
export class WebhookAlertChannel implements AlertChannel {
  readonly name = 'webhook';

  constructor(
    private readonly webhookUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(alert: Alert): Promise<void> {
    await this.fetchFn(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `**[${alert.severity.toUpperCase()}] ${alert.rule}**\n${alert.message}`,
      }),
    });
  }
}

export type AlertRule = {
  name: string;
  severity: Alert['severity'];
  /** Error count within the window that triggers the alert. */
  errorThreshold: number;
  windowMs: number;
  /** Optional: only count errors from this service. */
  service?: string;
};

/** Evaluates alert rules against collected errors and fans alerts out to channels. */
export class AlertManager {
  private readonly rules: AlertRule[] = [];
  private readonly channels: AlertChannel[] = [];
  private readonly lastTriggered = new Map<string, number>();
  readonly history: Alert[] = [];

  constructor(
    private readonly errors: ErrorCollector,
    private readonly clock: Clock = systemClock,
    /** Minimum time between repeated alerts for the same rule. */
    private readonly cooldownMs = 5 * 60 * 1000,
  ) {}

  addRule(rule: AlertRule): this {
    this.rules.push(rule);
    return this;
  }

  addChannel(channel: AlertChannel): this {
    this.channels.push(channel);
    return this;
  }

  /** Evaluate all rules; send alerts for those exceeding their threshold. */
  async evaluate(): Promise<Alert[]> {
    const now = this.clock.now();
    const triggered: Alert[] = [];

    for (const rule of this.rules) {
      const last = this.lastTriggered.get(rule.name);
      if (last !== undefined && now.getTime() - last < this.cooldownMs) continue;

      const since = new Date(now.getTime() - rule.windowMs);
      const errorCount = this.errors
        .list({ ...(rule.service !== undefined ? { service: rule.service } : {}), limit: 10_000 })
        .filter((e) => e.createdAt >= since).length;

      if (errorCount >= rule.errorThreshold) {
        const alert: Alert = {
          rule: rule.name,
          severity: rule.severity,
          message: `${errorCount} error(s) in the last ${Math.round(rule.windowMs / 1000)}s (threshold: ${rule.errorThreshold})`,
          context: { errorCount, ...(rule.service !== undefined ? { service: rule.service } : {}) },
          triggeredAt: now,
        };
        triggered.push(alert);
        this.history.push(alert);
        this.lastTriggered.set(rule.name, now.getTime());
        for (const channel of this.channels) {
          await channel.send(alert);
        }
      }
    }
    return triggered;
  }
}
