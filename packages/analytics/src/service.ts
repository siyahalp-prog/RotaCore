import { z } from 'zod';
import {
  ValidationError,
  dayKeyUtc,
  daysAgo,
  newId,
  systemClock,
  type Clock,
} from '@rota-core/core';
import type { AnalyticsStore } from './store.js';
import { parseUserAgent } from './user-agent.js';
import type {
  ActiveUsers,
  AnalyticsEvent,
  DayCount,
  FunnelStepResult,
  NameCount,
  TrackInput,
} from './types.js';

export const PAGE_VIEW_EVENT = 'page_view';

/**
 * Strip query parameters and fragments from a URL.
 * Accepts both full URLs (https://...) and path-only strings (/path?q=1).
 * On parse failure, strips everything after '?' as a safe fallback.
 *
 * Privacy rationale: query parameters frequently carry sensitive data
 * (search terms, reset tokens, session identifiers, email addresses).
 */
function stripQueryParams(url: string | undefined): string | undefined {
  if (url === undefined || url === '') return url;
  try {
    const base = url.startsWith('http') ? undefined : 'http://localhost';
    const parsed = base !== undefined ? new URL(url, base) : new URL(url);
    // For path-only inputs return just the pathname; for full URLs keep origin+path.
    return url.startsWith('http')
      ? `${parsed.protocol}//${parsed.host}${parsed.pathname}`
      : parsed.pathname;
  } catch {
    // Graceful degradation: strip from '?' onward
    return url.split('?')[0];
  }
}

export const trackInputSchema = z.object({
  eventName: z.string().min(1).max(128),
  pageUrl: z.string().max(2048).optional(),
  referrer: z.string().max(2048).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  sessionId: z.string().min(1).max(128),
  visitorId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128).optional(),
  userAgent: z.string().max(1024).optional(),
  country: z.string().max(64).optional(),
  correlationId: z.string().max(128).optional(),
  optOut: z.boolean().optional(),
});

export class AnalyticsService {
  constructor(
    private readonly store: AnalyticsStore,
    private readonly clock: Clock = systemClock,
  ) {}

  /**
   * Record a tracking event. Privacy rules:
   * - opt-out events are silently dropped
   * - no raw IP address is ever stored
   * - user agent is reduced to coarse browser/device families
   */
  async track(input: TrackInput): Promise<AnalyticsEvent | null> {
    const parsed = trackInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError('Invalid tracking event', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const data = parsed.data;
    if (data.optOut === true) return null;

    const { browser, device } = parseUserAgent(data.userAgent);
    const event: AnalyticsEvent = {
      id: newId(),
      eventName: data.eventName,
      // Strip query parameters before storage — they frequently contain PII
      // (search terms, reset tokens, session IDs, email addresses in URLs).
      pageUrl: stripQueryParams(data.pageUrl),
      referrer: stripQueryParams(data.referrer),
      eventProperties: data.properties,
      sessionId: data.sessionId,
      visitorId: data.visitorId,
      userId: data.userId,
      // Raw userAgent intentionally NOT stored after parsing.
      // Only coarse browser/device categories are persisted to minimise
      // fingerprinting surface area (GDPR / privacy-by-design).
      browser,
      device,
      country: data.country,
      correlationId: data.correlationId,
      createdAt: this.clock.now(),
    };
    await this.store.insert(event);
    return event;
  }

  async trackPageView(input: Omit<TrackInput, 'eventName'>): Promise<AnalyticsEvent | null> {
    return this.track({ ...input, eventName: PAGE_VIEW_EVENT });
  }

  // ---------------------------------------------------------------- queries

  async pageViewsByDay(from: Date, to: Date): Promise<DayCount[]> {
    const events = await this.store.findBetween(from, to, PAGE_VIEW_EVENT);
    const byDay = new Map<string, number>();
    for (const event of events) {
      const key = dayKeyUtc(event.createdAt);
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    return [...byDay.entries()]
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }

  async topPages(from: Date, to: Date, limit = 10): Promise<NameCount[]> {
    const events = await this.store.findBetween(from, to, PAGE_VIEW_EVENT);
    return countBy(events, (e) => e.pageUrl).slice(0, limit);
  }

  async topReferrers(from: Date, to: Date, limit = 10): Promise<NameCount[]> {
    const events = await this.store.findBetween(from, to, PAGE_VIEW_EVENT);
    return countBy(
      events.filter((e) => e.referrer !== undefined && e.referrer !== ''),
      (e) => e.referrer,
    ).slice(0, limit);
  }

  async eventsByName(from: Date, to: Date, limit = 20): Promise<NameCount[]> {
    const events = await this.store.findBetween(from, to);
    return countBy(events, (e) => e.eventName).slice(0, limit);
  }

  /** DAU/WAU/MAU based on distinct visitors (logged-in users count once via userId). */
  async activeUsers(reference: Date = this.clock.now()): Promise<ActiveUsers> {
    const distinctSince = async (from: Date): Promise<number> => {
      const events = await this.store.findBetween(from, reference);
      const ids = new Set(events.map((e) => e.userId ?? e.visitorId));
      return ids.size;
    };
    return {
      dau: await distinctSince(daysAgo(1, reference)),
      wau: await distinctSince(daysAgo(7, reference)),
      mau: await distinctSince(daysAgo(30, reference)),
    };
  }

  /**
   * Simple ordered funnel: a visitor counts for step N only if they performed
   * every previous step earlier in the window.
   */
  async funnel(steps: string[], from: Date, to: Date): Promise<FunnelStepResult[]> {
    if (steps.length === 0) return [];
    const events = await this.store.findBetween(from, to);

    const byVisitor = new Map<string, AnalyticsEvent[]>();
    for (const event of events) {
      const key = event.userId ?? event.visitorId;
      const list = byVisitor.get(key) ?? [];
      list.push(event);
      byVisitor.set(key, list);
    }

    const stepCounts = new Array<number>(steps.length).fill(0);
    for (const visitorEvents of byVisitor.values()) {
      let stepIndex = 0;
      for (const event of visitorEvents) {
        if (stepIndex < steps.length && event.eventName === steps[stepIndex]) {
          stepCounts[stepIndex] = (stepCounts[stepIndex] ?? 0) + 1;
          stepIndex += 1;
        }
      }
    }

    const start = stepCounts[0] ?? 0;
    return steps.map((eventName, i) => {
      const visitors = stepCounts[i] ?? 0;
      const previous = i === 0 ? visitors : (stepCounts[i - 1] ?? 0);
      return {
        eventName,
        visitors,
        conversionFromPrevious: previous === 0 ? 0 : visitors / previous,
        conversionFromStart: start === 0 ? 0 : visitors / start,
      };
    });
  }
}

function countBy(
  events: AnalyticsEvent[],
  selector: (event: AnalyticsEvent) => string | undefined,
): NameCount[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = selector(event);
    if (key === undefined || key === '') continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}
