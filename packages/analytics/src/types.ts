export type AnalyticsEvent = {
  id: string;
  /** 'page_view' for page views, otherwise the custom event name. */
  eventName: string;
  pageUrl?: string | undefined;
  referrer?: string | undefined;
  eventProperties?: Record<string, unknown> | undefined;
  sessionId: string;
  visitorId: string;
  userId?: string | undefined;
  userAgent?: string | undefined;
  browser?: string | undefined;
  device?: string | undefined;
  /** Country placeholder: resolved from a privacy-friendly source later, never from stored raw IPs. */
  country?: string | undefined;
  correlationId?: string | undefined;
  createdAt: Date;
};

export type TrackInput = {
  eventName: string;
  pageUrl?: string;
  referrer?: string;
  properties?: Record<string, unknown>;
  sessionId: string;
  visitorId: string;
  userId?: string;
  userAgent?: string;
  country?: string;
  correlationId?: string;
  /** When true (browser Do-Not-Track / user opt-out), the event is dropped. */
  optOut?: boolean;
};

export type DayCount = { day: string; count: number };
export type NameCount = { name: string; count: number };

export type ActiveUsers = { dau: number; wau: number; mau: number };

export type FunnelStepResult = {
  eventName: string;
  visitors: number;
  conversionFromPrevious: number;
  conversionFromStart: number;
};
