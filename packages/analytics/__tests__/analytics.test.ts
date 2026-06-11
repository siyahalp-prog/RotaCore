import { describe, expect, it } from 'vitest';
import type { Clock } from '@rota-core/core';
import {
  AnalyticsService,
  InMemoryAnalyticsStore,
  buildTrackingScript,
  parseUserAgent,
} from '../src/index.js';

const T0 = new Date('2026-01-15T12:00:00Z');

function clockAt(date: Date): Clock & { set(d: Date): void } {
  let now = date;
  return { now: () => now, set: (d) => (now = d) };
}

function setup() {
  const clock = clockAt(T0);
  const store = new InMemoryAnalyticsStore();
  const service = new AnalyticsService(store, clock);
  return { clock, store, service };
}

const base = { sessionId: 's1', visitorId: 'v1' };

describe('Rota Analytics', () => {
  it('tracks page views with parsed user agent', async () => {
    const { service } = setup();
    const event = await service.trackPageView({
      ...base,
      pageUrl: '/scholarships',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
    });
    expect(event?.eventName).toBe('page_view');
    expect(event?.browser).toBe('chrome');
    expect(event?.device).toBe('desktop');
  });

  it('drops opted-out events', async () => {
    const { service, store } = setup();
    const event = await service.track({ ...base, eventName: 'click', optOut: true });
    expect(event).toBeNull();
    expect(await store.findBetween(new Date(0), new Date('2100-01-01'))).toHaveLength(0);
  });

  it('rejects invalid input', async () => {
    const { service } = setup();
    await expect(
      service.track({ eventName: '', sessionId: 's', visitorId: 'v' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('aggregates page views by day and top pages/referrers', async () => {
    const { clock, service } = setup();
    clock.set(new Date('2026-01-10T10:00:00Z'));
    await service.trackPageView({ ...base, pageUrl: '/home', referrer: 'https://google.com' });
    await service.trackPageView({ ...base, pageUrl: '/home' });
    clock.set(new Date('2026-01-11T10:00:00Z'));
    await service.trackPageView({
      ...base,
      pageUrl: '/scholarships',
      referrer: 'https://google.com',
    });

    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-02-01T00:00:00Z');

    expect(await service.pageViewsByDay(from, to)).toEqual([
      { day: '2026-01-10', count: 2 },
      { day: '2026-01-11', count: 1 },
    ]);
    expect((await service.topPages(from, to))[0]).toEqual({ name: '/home', count: 2 });
    expect((await service.topReferrers(from, to))[0]).toEqual({
      name: 'https://google.com',
      count: 2,
    });
  });

  it('computes DAU / WAU / MAU on distinct visitors', async () => {
    const { clock, service } = setup();
    const ref = new Date('2026-01-30T12:00:00Z');

    clock.set(new Date('2026-01-30T10:00:00Z'));
    await service.track({ eventName: 'login', sessionId: 's1', visitorId: 'v1' });
    await service.track({ eventName: 'login', sessionId: 's2', visitorId: 'v2' });
    clock.set(new Date('2026-01-26T10:00:00Z'));
    await service.track({ eventName: 'login', sessionId: 's3', visitorId: 'v3' });
    clock.set(new Date('2026-01-05T10:00:00Z'));
    await service.track({ eventName: 'login', sessionId: 's4', visitorId: 'v4' });

    expect(await service.activeUsers(ref)).toEqual({ dau: 2, wau: 3, mau: 4 });
  });

  it('computes ordered funnel conversion', async () => {
    const { clock, service } = setup();
    const track = async (visitorId: string, eventName: string, minute: number) => {
      clock.set(new Date(Date.UTC(2026, 0, 20, 10, minute)));
      await service.track({ eventName, sessionId: visitorId, visitorId });
    };

    // v1 completes the funnel, v2 stops after signup, v3 only views
    await track('v1', 'view_scholarship', 1);
    await track('v1', 'signup', 2);
    await track('v1', 'save_scholarship', 3);
    await track('v2', 'view_scholarship', 1);
    await track('v2', 'signup', 2);
    await track('v3', 'view_scholarship', 1);

    const result = await service.funnel(
      ['view_scholarship', 'signup', 'save_scholarship'],
      new Date('2026-01-20T00:00:00Z'),
      new Date('2026-01-21T00:00:00Z'),
    );

    expect(result.map((r) => r.visitors)).toEqual([3, 2, 1]);
    expect(result[1]?.conversionFromPrevious).toBeCloseTo(2 / 3);
    expect(result[2]?.conversionFromStart).toBeCloseTo(1 / 3);
  });

  it('builds a tracking script that respects DNT and uses the endpoint', () => {
    const script = buildTrackingScript('https://analytics.rota.app/track');
    expect(script).toContain('doNotTrack');
    expect(script).toContain('https://analytics.rota.app/track');
    expect(script).not.toContain('canvas'); // no fingerprinting
  });

  it('parses common user agents coarsely', () => {
    expect(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile Safari/604.1')).toEqual({
      browser: 'safari',
      device: 'mobile',
    });
    expect(parseUserAgent(undefined)).toEqual({ browser: 'unknown', device: 'unknown' });
  });
});
