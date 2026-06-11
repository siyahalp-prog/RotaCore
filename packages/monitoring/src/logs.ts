import { newId, systemClock, type Clock } from '@rota-core/core';

export type IngestedLog = {
  id: string;
  service: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown> | undefined;
  createdAt: Date;
};

export type IngestLogInput = Omit<IngestedLog, 'id' | 'createdAt'>;

/** Central log ingestion for services that ship logs to Rota Monitoring. */
export class LogIngestion {
  private readonly logs: IngestedLog[] = [];

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly maxEntries = 10_000,
  ) {}

  ingest(input: IngestLogInput): IngestedLog {
    const entry: IngestedLog = { id: newId(), ...input, createdAt: this.clock.now() };
    this.logs.push(entry);
    if (this.logs.length > this.maxEntries) this.logs.shift();
    return entry;
  }

  query(
    options: { service?: string; level?: IngestedLog['level']; limit?: number } = {},
  ): IngestedLog[] {
    let results = [...this.logs];
    if (options.service !== undefined)
      results = results.filter((l) => l.service === options.service);
    if (options.level !== undefined) results = results.filter((l) => l.level === options.level);
    return results.slice(-(options.limit ?? 100)).reverse();
  }
}
