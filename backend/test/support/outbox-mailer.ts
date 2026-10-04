import { Mailer, type OutgoingMail } from '../../src/notifications/mail/mailer.js';

/** Email without a server, for the integration suites: sending is recording. */
export class OutboxMailer extends Mailer {
  /** Switch off to act like a server with no SMTP configured. */
  enabled = true;
  readonly sent: OutgoingMail[] = [];
  /** Set to make the next send fail, as an unreachable server would. */
  failNext = false;

  send(mail: OutgoingMail): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('SMTP server unreachable'));
    }
    this.sent.push(mail);
    return Promise.resolve();
  }
}
