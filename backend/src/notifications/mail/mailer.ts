export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers, such as `List-Unsubscribe`. */
  headers?: Record<string, string>;
}

/**
 * Outgoing email, as far as the application cares.
 *
 * An abstract class so it can be the injection token itself, like
 * `ObjectStorage`. `SmtpMailer` speaks to any SMTP server — Mailpit locally, a
 * provider in production; the integration suite substitutes an outbox, so CI
 * sends nothing and needs no server.
 */
export abstract class Mailer {
  /** False when no transport is configured: notifications stay in-app only. */
  abstract readonly enabled: boolean;

  /** Resolves once the server has accepted the message; rejects otherwise, so the job retries. */
  abstract send(mail: OutgoingMail): Promise<void>;
}
