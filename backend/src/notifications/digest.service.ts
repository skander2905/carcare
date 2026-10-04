import { Inject, Injectable, Logger } from '@nestjs/common';
import { mailConfig } from '../config/configuration.js';
import { type MailConfig } from '../config/config.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { renderDigest } from './domain/digest.js';
import { signUnsubscribe } from './domain/unsubscribe-link.js';
import { Mailer } from './mail/mailer.js';
import { notificationPath } from './notification-links.js';
import { NotificationsRepository } from './notifications.repository.js';

export type DigestOutcome = 'sent' | 'nothing-to-send' | 'skipped';

/**
 * Emails a user everything still owed an email, as one message.
 *
 * The rows are claimed, the email is sent and the rows are marked sent inside
 * one transaction. If sending fails the transaction rolls back, the rows stay
 * owed, and the job's retry — or the next sweep — tries again. The one gap is a
 * crash between the server accepting the email and the commit, which sends it
 * twice: at-least-once, which is the right way round for a reminder.
 */
@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsRepository,
    private readonly mailer: Mailer,
    @Inject(mailConfig.KEY) private readonly config: MailConfig,
  ) {}

  async send(userId: string, now = new Date()): Promise<DigestOutcome> {
    return this.prisma.$transaction(
      async (tx) => {
        const claimed = await this.notifications.claimUnsent(tx, userId);
        if (claimed.length === 0) return 'nothing-to-send';

        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { email: true, displayName: true, emailNotifications: true, emailVerifiedAt: true },
        });

        // Turned off since these were queued, the address is unconfirmed, or the transport has gone.
        if (!user?.emailNotifications || !user.emailVerifiedAt || !this.mailer.enabled) {
          await this.notifications.settleEmail(
            tx,
            claimed.map((n) => n.id),
            { emailStatus: 'SKIPPED' },
          );
          return 'skipped';
        }

        // Already seen in the app before the morning came: no need to email it.
        const unread = claimed.filter((n) => n.readAt === null);
        const read = claimed.filter((n) => n.readAt !== null);
        await this.notifications.settleEmail(
          tx,
          read.map((n) => n.id),
          { emailStatus: 'SKIPPED' },
        );
        if (unread.length === 0) return 'nothing-to-send';

        const unsubscribe = signUnsubscribe(userId, this.config.linkSigningKey);
        const email = renderDigest(
          user.displayName,
          unread.map((n) => ({
            title: n.title,
            body: n.body,
            link: `${this.config.webAppUrl}${notificationPath(n.type, n.data, n.vehicleId)}`,
          })),
          `${this.config.webAppUrl}/unsubscribe?token=${encodeURIComponent(unsubscribe)}`,
        );

        await this.mailer.send({
          to: user.email,
          ...email,
          // RFC 8058: Gmail and others show their own "Unsubscribe" button,
          // which POSTs here without opening anything.
          headers: {
            'List-Unsubscribe': `<${this.config.apiBaseUrl}/notifications/unsubscribe?token=${encodeURIComponent(unsubscribe)}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });
        await this.notifications.settleEmail(
          tx,
          unread.map((n) => n.id),
          { emailStatus: 'SENT', emailedAt: now },
        );
        this.logger.log(`Emailed ${unread.length} reminder(s) to user ${userId}`);
        return 'sent';
      },
      // Long enough for a slow SMTP handshake; the mailer's own timeouts are shorter.
      { timeout: 45_000 },
    );
  }
}
