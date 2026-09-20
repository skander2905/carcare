import { Injectable } from '@nestjs/common';
import { type OAuthProvider } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { type OAuthAccount, type User } from '../../prisma/model.types.js';

export interface NewOAuthAccount {
  userId: string;
  provider: OAuthProvider;
  providerAccountId: string;
  email?: string;
}

@Injectable()
export class OAuthAccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The link, with its user — one query, because the caller always needs both. */
  findByProviderAccount(
    provider: OAuthProvider,
    providerAccountId: string,
  ): Promise<(OAuthAccount & { user: User }) | null> {
    return this.prisma.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId } },
      include: { user: true },
    });
  }

  findForUser(userId: string): Promise<OAuthAccount[]> {
    return this.prisma.oAuthAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  create(data: NewOAuthAccount): Promise<OAuthAccount> {
    return this.prisma.oAuthAccount.create({ data });
  }

  /**
   * Creates the user and its first provider link together.
   *
   * One transaction because a user row with no credential of any kind is an
   * account nobody can ever sign into — and it would occupy the email address,
   * so the person could not retry either.
   */
  createUserWithAccount(
    user: { email: string; displayName: string },
    account: Omit<NewOAuthAccount, 'userId'>,
  ): Promise<User> {
    return this.prisma.user.create({
      data: {
        ...user,
        // No passwordHash: this account has never had one.
        oauthAccounts: { create: account },
      },
    });
  }

  /** Records the address the provider last reported, for display only. */
  async touchEmail(id: string, email: string | undefined): Promise<void> {
    await this.prisma.oAuthAccount.update({ where: { id }, data: { email: email ?? null } });
  }

  async deleteForUser(userId: string, provider: OAuthProvider): Promise<number> {
    const { count } = await this.prisma.oAuthAccount.deleteMany({ where: { userId, provider } });
    return count;
  }
}
