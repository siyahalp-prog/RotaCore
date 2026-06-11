import { newId, systemClock, type Clock } from '@rota-core/core';

export type ErrorRecord = {
  id: string;
  fingerprint: string;
  service: string;
  message: string;
  stack?: string | undefined;
  context?: Record<string, unknown> | undefined;
  createdAt: Date;
};

export type CaptureErrorInput = {
  service: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
};

/** Group key: service + first line of the message. Keeps similar errors together. */
function fingerprintOf(service: string, message: string): string {
  return `${service}:${message.split('\n')[0]?.slice(0, 200) ?? ''}`;
}

export type ErrorListener = (record: ErrorRecord) => void;

/** Collects application errors, groups them by fingerprint and notifies listeners (e.g. AlertManager). */
export class ErrorCollector {
  private readonly records: ErrorRecord[] = [];
  private readonly listeners: ErrorListener[] = [];

  constructor(private readonly clock: Clock = systemClock) {}

  onError(listener: ErrorListener): void {
    this.listeners.push(listener);
  }

  capture(input: CaptureErrorInput): ErrorRecord {
    const record: ErrorRecord = {
      id: newId(),
      fingerprint: fingerprintOf(input.service, input.message),
      service: input.service,
      message: input.message,
      stack: input.stack,
      context: input.context,
      createdAt: this.clock.now(),
    };
    this.records.push(record);
    for (const listener of this.listeners) listener(record);
    return record;
  }

  captureException(
    service: string,
    error: unknown,
    context?: Record<string, unknown>,
  ): ErrorRecord {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    return this.capture({
      service,
      message,
      ...(stack !== undefined ? { stack } : {}),
      ...(context !== undefined ? { context } : {}),
    });
  }

  list(options: { service?: string; limit?: number } = {}): ErrorRecord[] {
    let results = [...this.records];
    if (options.service !== undefined) {
      results = results.filter((r) => r.service === options.service);
    }
    return results.slice(-(options.limit ?? 100)).reverse();
  }

  countByFingerprint(since?: Date): { fingerprint: string; count: number; lastMessage: string }[] {
    const groups = new Map<string, { count: number; lastMessage: string }>();
    for (const record of this.records) {
      if (since !== undefined && record.createdAt < since) continue;
      const group = groups.get(record.fingerprint) ?? { count: 0, lastMessage: record.message };
      group.count += 1;
      group.lastMessage = record.message;
      groups.set(record.fingerprint, group);
    }
    return [...groups.entries()]
      .map(([fingerprint, g]) => ({ fingerprint, ...g }))
      .sort((a, b) => b.count - a.count);
  }
}
