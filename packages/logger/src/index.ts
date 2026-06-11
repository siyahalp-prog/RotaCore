/**
 * Shared structured logger for Rota Core.
 * Zero-dependency JSON line logger with secret redaction.
 * Can later be swapped for pino behind the same interface.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99,
};

const DEFAULT_REDACT_KEYS = [
  // Authentication / credentials
  'password',
  'token',
  'secret',
  'authorization',
  'apikey',
  'api_key',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'cookie',
  'session',
  'sessionid',
  'session_id',
  // PII — GDPR / CCPA / PCI-DSS
  'email',
  'email_address',
  'phone',
  'phone_number',
  'mobile',
  'creditcard',
  'credit_card',
  'cardnumber',
  'card_number',
  'cvv',
  'ssn',
  'national_id',
  'ip',
  'ip_address',
  'ipaddress',
];

export type Logger = {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
};

export type LoggerOptions = {
  name?: string;
  level?: LogLevel;
  redactKeys?: string[];
  /** Sink for log lines; defaults to console. Overridable in tests. */
  write?: (line: string) => void;
};

function redact(value: unknown, redactKeys: Set<string>, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, redactKeys, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = redactKeys.has(key.toLowerCase())
      ? '[REDACTED]'
      : redact(val, redactKeys, depth + 1);
  }
  return out;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const redactKeys = new Set(
    (options.redactKeys ?? DEFAULT_REDACT_KEYS).map((k) => k.toLowerCase()),
  );
  const write = options.write ?? ((line: string) => console.log(line));
  const baseBindings: Record<string, unknown> =
    options.name !== undefined ? { name: options.name } : {};

  function make(bindings: Record<string, unknown>): Logger {
    function log(
      lvl: Exclude<LogLevel, 'silent'>,
      message: string,
      context?: Record<string, unknown>,
    ): void {
      if (LEVEL_WEIGHT[lvl] < LEVEL_WEIGHT[level]) return;
      const entry = {
        level: lvl,
        time: new Date().toISOString(),
        msg: message,
        ...bindings,
        ...(context !== undefined ? (redact(context, redactKeys) as Record<string, unknown>) : {}),
      };
      write(JSON.stringify(entry));
    }
    return {
      debug: (m, c) => log('debug', m, c),
      info: (m, c) => log('info', m, c),
      warn: (m, c) => log('warn', m, c),
      error: (m, c) => log('error', m, c),
      child: (childBindings) => make({ ...bindings, ...childBindings }),
    };
  }

  return make(baseBindings);
}

/** No-op logger, useful as a default in libraries and tests. */
export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => noopLogger,
};
