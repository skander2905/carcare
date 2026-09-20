import { Injectable } from '@nestjs/common';
import { type RefreshToken } from '../prisma/model.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface NewRefreshToken {
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: NewRefreshToken): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({ data });
  }

  findByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  /**
   * Revokes the presented token and issues its successor in one transaction.
   *
   * The conditional `revokedAt: null` is the concurrency control: two requests
   * presenting the same token both try to revoke it, exactly one matches a row,
   * and the loser gets `null` back instead of silently minting a second token
   * from an already-spent one. Doing it as read-then-write would let both win.
   *
   * Returns `null` when the token was already revoked by a concurrent caller.
   */
  rotate(currentTokenId: string, replacement: NewRefreshToken): Promise<RefreshToken | null> {
    return this.prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.updateMany({
        where: { id: currentTokenId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      if (revoked.count === 0) return null;

      return tx.refreshToken.create({ data: replacement });
    });
  }

  /**
   * Whether the session behind a family is still running — at least one token
   * in it is neither revoked nor expired.
   *
   * This is what separates a rotation from an ending. A token revoked a second
   * ago could have been spent by an ordinary refresh (the family carries on) or
   * by a logout or a replay revocation (the family is dead). The row itself
   * cannot tell them apart; the state of its siblings can.
   */
  async hasLiveToken(familyId: string, now: Date = new Date()): Promise<boolean> {
    const live = await this.prisma.refreshToken.count({
      where: { familyId, revokedAt: null, expiresAt: { gt: now } },
    });
    return live > 0;
  }

  /**
   * Kills every live token descended from one login.
   *
   * Used for logout (end this session) and for replay detection (end this
   * session *and* whoever stole it — there is no way to tell the thief from
   * the victim, so both are forced to authenticate again).
   */
  async revokeFamily(familyId: string): Promise<number> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /** Every session on every device — for password changes and account recovery. */
  async revokeAllForUser(userId: string): Promise<number> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /**
   * Housekeeping for rows that can no longer authenticate anything. Called by
   * the maintenance queue in Phase 7; harmless to run at any time.
   */
  async deleteExpiredBefore(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    return count;
  }
}
