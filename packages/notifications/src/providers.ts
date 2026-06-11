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

/** Development provider: logs the email instead of sending it. Never logs secrets. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';

  constructor(private readonly logger: Logger = noopLogger) {}

  async sendEmail(message: EmailMessage): Promise<void> {
    this.logger.info('Email (console provider)', {
      to: message.to,
      subject: message.subject,
      bodyPreview: message.body.slice(0, 200),
      ...(message.correlationId !== undefined ? { correlationId: message.correlationId } : {}),
    });
  }
}

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
};

/**
 * SMTP provider placeholder. Wire a real SMTP client (e.g. nodemailer) here
 * when email goes to production. Configuration is injected; never hardcoded.
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';

  constructor(private readonly config: SmtpConfig) {
    if (!config.host) {
      throw new RotaError('CONFIG_ERROR', 'SMTP host is required', { statusCode: 500 });
    }
  }

  async sendEmail(_message: EmailMessage): Promise<void> {
    throw new RotaError(
      'NOT_IMPLEMENTED',
      'SMTP provider is a placeholder; integrate a real SMTP client before production use',
      {
        statusCode: 501,
        details: { host: this.config.host },
      },
    );
  }
}
