import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { mailConfig } from '../../config/configuration.js';
import { type MailConfig } from '../../config/config.types.js';
import { Mailer, type OutgoingMail } from './mailer.js';

@Injectable()
export class SmtpMailer extends Mailer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SmtpMailer.name);
  readonly enabled: boolean;
  private readonly transport: Transporter | undefined;

  constructor(@Inject(mailConfig.KEY) private readonly config: MailConfig) {
    super();
    this.enabled = config.enabled;
    this.transport = config.enabled
      ? nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: config.secure,
          auth: config.auth,
          // A stuck server must fail the job, which retries, rather than hold
          // the digest's row locks open indefinitely.
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
        })
      : undefined;
  }

  async send(mail: OutgoingMail): Promise<void> {
    if (!this.transport) throw new ServiceUnavailableException('Email is not configured');
    await this.transport.sendMail({ from: this.config.from, ...mail });
  }

  /**
   * Says at start-up whether email will work, rather than at 08:00 when the
   * first digest fails. Not awaited: a slow server must not hold up boot, and
   * a wrong setting should not take the API down — the inbox still works.
   */
  onApplicationBootstrap(): void {
    if (!this.transport) {
      this.logger.warn('Email is off (no SMTP_HOST): reminders reach the in-app inbox only');
      return;
    }
    const where = `${this.config.host}:${this.config.port}`;
    this.transport.verify().then(
      () => this.logger.log(`Email ready: ${where}, sending as ${this.config.from}`),
      (error: unknown) =>
        this.logger.error(
          `Email is configured but ${where} refused us: ${(error as Error).message}. ` +
            'Check SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER and SMTP_PASSWORD.',
        ),
    );
  }

  onModuleDestroy(): void {
    this.transport?.close();
  }
}
