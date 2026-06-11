export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export type HealthCheckResult = {
  name: string;
  status: HealthStatus;
  latencyMs: number;
  message?: string | undefined;
};

export type HealthReport = {
  status: HealthStatus;
  checks: HealthCheckResult[];
  checkedAt: Date;
};

export type HealthCheckFn = () =>
  | Promise<{ ok: boolean; message?: string }>
  | { ok: boolean; message?: string };

/** Registry of named health checks (database, cache, downstream services...). */
export class HealthCheckRegistry {
  private readonly checks = new Map<string, HealthCheckFn>();

  register(name: string, check: HealthCheckFn): this {
    this.checks.set(name, check);
    return this;
  }

  async run(): Promise<HealthReport> {
    const results: HealthCheckResult[] = [];
    for (const [name, check] of this.checks) {
      const start = performance.now();
      try {
        const outcome = await check();
        results.push({
          name,
          status: outcome.ok ? 'healthy' : 'unhealthy',
          latencyMs: Math.round(performance.now() - start),
          message: outcome.message,
        });
      } catch (error) {
        results.push({
          name,
          status: 'unhealthy',
          latencyMs: Math.round(performance.now() - start),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const unhealthy = results.filter((r) => r.status === 'unhealthy').length;
    const status: HealthStatus =
      unhealthy === 0 ? 'healthy' : unhealthy === results.length ? 'unhealthy' : 'degraded';
    return { status, checks: results, checkedAt: new Date() };
  }
}
