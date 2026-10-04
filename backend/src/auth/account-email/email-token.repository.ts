import { Injectable } from '@nestjs/common';
import { type EmailTokenPurpose } from '../../generated/prisma/enums.js';
import { type PrismaLike } from '../../odometer/odometer.repository.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { type EmailToken } from '../../prisma/model.types.js';

@Injectable()
export class EmailTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Issuing a new link retires any earlier unused one for the same purpose. */
  async replace(data: {
    userId: string;
    purpose: EmailTokenPurpose;
    tokenHash: string;
    email: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.emailToken.deleteMany({
        where: { userId: data.userId, purpose: data.purpose, usedAt: null },
      }),
      this.prisma.emailToken.create({ data }),
    ]);
  }

  findByHash(client: PrismaLike, tokenHash: string): Promise<EmailToken | null> {
    return client.emailToken.findUnique({ where: { tokenHash } });
  }

  /**
   * Spends the token. The conditional `usedAt: null` is the race guard: two
   * clicks at once both try, exactly one matches.
   */
  async consume(client: PrismaLike, id: string, at: Date): Promise<boolean> {
    const { count } = await client.emailToken.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: at },
    });
    return count === 1;
  }
}
