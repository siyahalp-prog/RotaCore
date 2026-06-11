import nodemailer, { type Transporter } from 'nodemailer';
import { RotaError } from '@rota-core/core';
import { noopLogger, type Logger } from '@rota-core/logger';

export type EmailMessage = {
  to: string;
  subject: string;
  body: string;
  correlationId?: string | undefined;
};

/** Abstraction over email delivery so products never depend on a concrete provider. */
export type EmailProvider = {
  readonly name: string;
  sendEmail(message: EmailMessage): Promise<void>;
};

/**
 * Masks a full email address for safe log output.
 * `alice@example.com` → `a***@example.com`
 */
function maskEmail(email: string): string {
  const atIdx = email.indexOf('@');
  if (atIdx <= 0) return '***';
  const domain = email.slice(atIdx);
  const firstChar = email[0] ?? '*';
  return `${firstChar}***${domain}`;
}

// ---------------------------------------------------------------------------
// Console provider — development only
// ---------------------------------------------------------------------------

/**
 * Development provider: logs the email instead of sending it.
 * Safe for local development. Never use in production.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';

  constructor(private readonly logger: Logger = noopLogger) {}

  async sendEmail(message: EmailMessage): Promise<void> {
    this.logger.info('Email (console provider)', {
      to: maskEmail(message.to),
      subject: message.subject,
      bodyPreview: message.body.slice(0, 200),
      ...(message.correlationId !== undefined ? { correlationId: message.correlationId } : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// SMTP provider — production (nodemailer)
// ---------------------------------------------------------------------------

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  /** Verify the TLS certificate. Set false only for local mail servers. Default: true. */
  secure?: boolean;
};

/**
 * Production SMTP email provider backed by nodemailer.
 *
 * Configuration is injected, never hardcoded.
 * Supports STARTTLS (port 587) and TLS (port 465).
 *
 * Example usage:
 * ```ts
 * const email = new SmtpEmailProvider({
 *   host: env.SMTP_HOST,
 *   port: env.SMTP_PORT,
 *   user: env.SMTP_USER,
 *   password: env.SMTP_PASSWORD,
 *   from: env.SMTP_FROM,
 * });
 * createRotaCore({ emailProvider: email });
 * ```
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(private readonly config: SmtpConfig) {
    if (!config.host) {
      throw new RotaError('CONFIG_ERROR', 'SMTP host is required', { statusCode: 500 });
    }
    this.from = config.from;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      // Port 465 → implicit TLS; other ports use STARTTLS
      secure: config.secure ?? config.port === 465,
      auth: {
        user: config.user,
        pass: config.password,
      },
    });
  }

  async sendEmail(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.body,
      ...(message.correlationId !== undefined
        ? { headers: { 'X-Correlation-Id': message.correlationId } }
        : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// In-memory test provider — captures emails for assertion in tests
// ---------------------------------------------------------------------------

export type CapturedEmail = EmailMessage & { capturedAt: Date };

/**
 * Test email provider: records all sent emails in memory for assertions.
 * Never sends a real email.
 *
 * ```ts
 * const email = new InMemoryEmailProvider();
 * createRotaCore({ emailProvider: email });
 * // ... trigger notification ...
 * expect(email.sent).toHaveLength(1);
 * expect(email.sent[0].to).toBe('alice@example.com');
 * ```
 */
export class InMemoryEmailProvider implements EmailProvider {
  readonly name = 'in-memory';
  readonly sent: CapturedEmail[] = [];

  async sendEmail(message: EmailMessage): Promise<void> {
    this.sent.push({ ...message, capturedAt: new Date() });
  }

  clear(): void {
    this.sent.length = 0;
  }
}
