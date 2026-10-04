import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { mailConfig } from '../../config/configuration.js';
import { type MailConfig } from '../../config/config.types.js';
import { type EmailTokenPurpose } from '../../generated/prisma/enums.js';
import { Mailer } from '../../notifications/mail/mailer.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { type User } from '../../prisma/model.types.js';
import { hashPassword } from '../domain/password.js';
import { generateOpaqueToken, hashToken, isExpired } from '../domain/tokens.js';
import { RefreshTokenRepository } from '../refresh-token.repository.js';
import { type AccountEmail, resetPasswordMessage, verifyEmailMessage } from './domain/messages.js';
import { EmailTokenRepository } from './email-token.repository.js';

const HOUR = 3_600_000;
const LIFETIME: Record<EmailTokenPurpose, number> = {
  VERIFY_EMAIL: 48 * HOUR,
  // Short: a reset link is a password, sitting in an inbox.
  RESET_PASSWORD: 1 * HOUR,
};

const INVALID_LINK = 'This link has expired or was already used. Ask for a new one.';

/**
 * Emails that prove someone reads an address: confirming it, and resetting a
 * password through it.
 *
 * Links carry a random token; only its hash is stored, and it works once.
 * Sending is not awaited: a slow mail server must not slow the request, and
 * for "forgot password" the response must not take longer when the account
 * exists — that difference alone would tell a stranger who has an account.
 */
@Injectable()
export class AccountEmailService {
  private readonly logger = new Logger(AccountEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: EmailTokenRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly mailer: Mailer,
    @Inject(mailConfig.KEY) private readonly config: MailConfig,
  ) {}

  /** Sends "confirm your email". A no-op once confirmed. */
  async sendVerification(
    user: Pick<User, 'id' | 'email' | 'displayName' | 'emailVerifiedAt'>,
  ): Promise<void> {
    if (user.emailVerifiedAt) return;
    const token = await this.issue(user, 'VERIFY_EMAIL');
    this.send(
      user.email,
      verifyEmailMessage(user.displayName, `${this.config.webAppUrl}/verify-email?token=${token}`),
    );
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.sendVerification(user);
  }

  async verify(token: string, now = new Date()): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const record = await this.usable(tx, token, 'VERIFY_EMAIL', now);
      await tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: now } });
    });
  }

  /**
   * Always succeeds as far as the caller can tell: whether the address has an
   * account is not this endpoint's to reveal.
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;
    const token = await this.issue(user, 'RESET_PASSWORD');
    this.send(
      user.email,
      resetPasswordMessage(user.displayName, `${this.config.webAppUrl}/reset-password?token=${token}`),
    );
  }

  /**
   * Sets the new password, signs out every session — whoever had the old
   * password is not still signed in — and, since the link reached the inbox,
   * counts the address as confirmed.
   */
  async resetPassword(token: string, password: string, now = new Date()): Promise<void> {
    const passwordHash = await hashPassword(password);
    const userId = await this.prisma.$transaction(async (tx) => {
      const record = await this.usable(tx, token, 'RESET_PASSWORD', now);
      const user = await tx.user.findUniqueOrThrow({ where: { id: record.userId } });
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: now }) },
      });
      return user.id;
    });
    const revoked = await this.refreshTokens.revokeAllForUser(userId);
    this.logger.log(`Password reset for user ${userId}; signed out ${revoked} session(s)`);
  }

  private async issue(user: Pick<User, 'id' | 'email'>, purpose: EmailTokenPurpose): Promise<string> {
    const token = generateOpaqueToken();
    await this.tokens.replace({
      userId: user.id,
      purpose,
      tokenHash: hashToken(token),
      email: user.email,
      expiresAt: new Date(Date.now() + LIFETIME[purpose]),
    });
    return token;
  }

  /** The token's row, spent — or a 400 that says the same thing whatever went wrong. */
  private async usable(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    token: string,
    purpose: EmailTokenPurpose,
    now: Date,
  ) {
    const record = await this.tokens.findByHash(tx, hashToken(token));
    if (record?.purpose !== purpose || record.usedAt || isExpired(record.expiresAt, now)) {
      throw new BadRequestException(INVALID_LINK);
    }
    // Sent to an address the account no longer has: it proves nothing now.
    const user = await tx.user.findUnique({ where: { id: record.userId }, select: { email: true } });
    if (user?.email !== record.email) throw new BadRequestException(INVALID_LINK);
    if (!(await this.tokens.consume(tx, record.id, now))) throw new BadRequestException(INVALID_LINK);
    return record;
  }

  private send(to: string, email: AccountEmail): void {
    if (!this.mailer.enabled) {
      this.logger.warn(`Email is off, so "${email.subject}" was not sent`);
      return;
    }
    this.mailer.send({ to, ...email }).catch((error: unknown) => {
      this.logger.error(`Could not send "${email.subject}": ${(error as Error).message}`);
    });
  }
}
