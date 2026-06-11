export type EndpointStats = {
  endpoint: string;
  count: number;
  avgMs: number;
  maxMs: number;
  p95Ms: number;
};

/** Tracks API latency per endpoint and detects slow endpoints. */
export class LatencyTracker {
  private readonly samples = new Map<string, number[]>();

  constructor(private readonly maxSamplesPerEndpoint = 1000) {}

  record(endpoint: string, durationMs: number): void {
    const list = this.samples.get(endpoint) ?? [];
    list.push(durationMs);
    if (list.length > this.maxSamplesPerEndpoint) list.shift();
    this.samples.set(endpoint, list);
  }

  stats(): EndpointStats[] {
    const results: EndpointStats[] = [];
    for (const [endpoint, list] of this.samples) {
      if (list.length === 0) continue;
      const sorted = [...list].sort((a, b) => a - b);
      const sum = sorted.reduce((acc, v) => acc + v, 0);
      const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
      results.push({
        endpoint,
        count: sorted.length,
        avgMs: Math.round((sum / sorted.length) * 100) / 100,
        maxMs: sorted[sorted.length - 1] ?? 0,
        p95Ms: sorted[p95Index] ?? 0,
      });
    }
    return results.sort((a, b) => b.p95Ms - a.p95Ms);
  }

  /** Endpoints whose p95 latency exceeds the threshold. */
  slowEndpoints(thresholdMs = 500): EndpointStats[] {
    return this.stats().filter((s) => s.p95Ms > thresholdMs);
  }
}
