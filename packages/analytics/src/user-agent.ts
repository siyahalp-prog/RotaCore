/**
 * Lightweight, privacy-friendly user agent parsing.
 * Intentionally coarse: we only need browser family and device class,
 * never a unique fingerprint.
 */
export type ParsedUserAgent = { browser: string; device: string };

export function parseUserAgent(userAgent: string | undefined): ParsedUserAgent {
  if (userAgent === undefined || userAgent === '') {
    return { browser: 'unknown', device: 'unknown' };
  }
  const ua = userAgent.toLowerCase();

  let browser = 'other';
  if (ua.includes('edg/')) browser = 'edge';
  else if (ua.includes('opr/') || ua.includes('opera')) browser = 'opera';
  else if (ua.includes('chrome/')) browser = 'chrome';
  else if (ua.includes('firefox/')) browser = 'firefox';
  else if (ua.includes('safari/')) browser = 'safari';

  let device = 'desktop';
  if (ua.includes('ipad') || ua.includes('tablet')) device = 'tablet';
  else if (ua.includes('mobile') || ua.includes('iphone') || ua.includes('android')) {
    device = 'mobile';
  }

  return { browser, device };
}
