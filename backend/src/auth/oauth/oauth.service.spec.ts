import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type OAuthAccount, type User } from '../../prisma/model.types.js';
import { type UsersService } from '../../users/users.service.js';
import { type AuthService, type SessionContext } from '../auth.service.js';
import { OAUTH_ERRORS, OAuthService } from './oauth.service.js';
import { type OAuthStateService } from './oauth-state.service.js';
import { type OAuthAccountRepository } from './oauth-account.repository.js';
import { type ProviderRegistry } from './providers/provider.registry.js';
import { type ProviderIdentity } from './providers/oauth-provider.types.js';

const CONTEXT: SessionContext = { userAgent: 'vitest', ipAddress: '127.0.0.1' };

const IDENTITY: ProviderIdentity = {
  providerAccountId: 'google-sub-123',
  email: 'sam@example.com',
  emailVerified: true,
  displayName: 'Sam Ben Ali',
};

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'sam@example.com',
    passwordHash: null,
    displayName: 'Sam',
    role: 'USER',
    currency: 'TND',
    locale: 'en',
    timezone: 'Africa/Tunis',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildAccount(overrides: Partial<OAuthAccount> = {}): OAuthAccount {
  return {
    id: 'link-1',
    userId: 'user-1',
    provider: 'GOOGLE',
    providerAccountId: 'google-sub-123',
    email: 'sam@example.com',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

const buildMocks = () => ({
  registry: {
    require: vi.fn(),
    list: vi.fn<() => { slug: string; displayName: string }[]>(),
  },
  states: {
    save: vi.fn<(state: string, value: unknown) => Promise<void>>(),
    consume: vi.fn<(state: string) => Promise<unknown>>(),
  },
  accounts: {
    findByProviderAccount: vi.fn<(p: string, id: string) => Promise<unknown>>(),
    findForUser: vi.fn<(userId: string) => Promise<OAuthAccount[]>>(),
    create: vi.fn<(data: unknown) => Promise<OAuthAccount>>(),
    createUserWithAccount: vi.fn<(user: unknown, account: unknown) => Promise<User>>(),
    touchEmail: vi.fn<(id: string, email: string | undefined) => Promise<void>>(),
    deleteForUser: vi.fn<(userId: string, provider: string) => Promise<number>>(),
  },
  users: {
    findById: vi.fn<(id: string) => Promise<User | null>>(),
    findByEmail: vi.fn<(email: string) => Promise<User | null>>(),
  },
  auth: {
    startSessionFor: vi.fn<(user: User, context: SessionContext) => Promise<unknown>>(),
  },
});

const googleProvider = {
  id: 'GOOGLE' as const,
  slug: 'google',
  displayName: 'Google',
  buildAuthorizationRequest: vi.fn(() => ({ url: 'https://accounts.google.com/x', codeVerifier: 'v' })),
  exchangeCode: vi.fn<() => Promise<ProviderIdentity>>(),
};

describe('OAuthService', () => {
  let m: ReturnType<typeof buildMocks>;
  let service: OAuthService;

  beforeEach(() => {
    m = buildMocks();
    googleProvider.exchangeCode.mockReset().mockResolvedValue(IDENTITY);
    m.registry.require.mockReturnValue(googleProvider);
    m.auth.startSessionFor.mockResolvedValue({ accessToken: 'signed.token' });

    service = new OAuthService(
      m.registry as unknown as ProviderRegistry,
      m.states as unknown as OAuthStateService,
      m.accounts as unknown as OAuthAccountRepository,
      m.users as unknown as UsersService,
      m.auth as unknown as AuthService,
    );
  });

  describe('start', () => {
    it('remembers the PKCE verifier server-side, never in the redirect', async () => {
      const { authorizationUrl } = await service.start('google', '/vehicles');

      const [, stored] = m.states.save.mock.calls[0] as [string, { codeVerifier: string }];
      expect(stored.codeVerifier).toBe('v');
      // The verifier is the secret the code exchange is proved with; putting it
      // in the URL would hand it to anyone who sees the redirect.
      expect(authorizationUrl).not.toContain('v');
    });

    it('refuses to carry an off-site destination through the flow', async () => {
      await service.start('google', 'https://evil.example');

      const [, stored] = m.states.save.mock.calls[0] as [string, { returnTo: string }];
      expect(stored.returnTo).toBe('/dashboard');
    });

    it('records who asked, when linking to an existing account', async () => {
      await service.start('google', undefined, 'user-7');

      const [, stored] = m.states.save.mock.calls[0] as [string, { linkUserId?: string }];
      // Server-side, because the browser comes back from Google with no
      // Authorization header and the URL must not name the target account.
      expect(stored.linkUserId).toBe('user-7');
    });
  });

  describe('complete — state validation', () => {
    it('rejects a state that was never issued', async () => {
      m.states.consume.mockResolvedValue(null);

      await expect(service.complete('google', 'code', 'forged', CONTEXT)).rejects.toThrow(
        BadRequestException,
      );
      expect(googleProvider.exchangeCode).not.toHaveBeenCalled();
    });

    it('rejects a state issued for a different provider', async () => {
      m.states.consume.mockResolvedValue({ provider: 'apple', codeVerifier: 'v', returnTo: '/' });

      await expect(service.complete('google', 'code', 'state', CONTEXT)).rejects.toThrow(BadRequestException);
    });
  });

  describe('complete — signing in', () => {
    beforeEach(() => {
      m.states.consume.mockResolvedValue({ provider: 'google', codeVerifier: 'v', returnTo: '/dashboard' });
    });

    it('signs in an already-linked identity', async () => {
      const user = buildUser();
      m.accounts.findByProviderAccount.mockResolvedValue({ ...buildAccount(), user });

      const result = await service.complete('google', 'code', 'state', CONTEXT);

      expect(m.auth.startSessionFor).toHaveBeenCalledWith(user, CONTEXT);
      expect(result.returnTo).toBe('/dashboard');
      expect(m.accounts.createUserWithAccount).not.toHaveBeenCalled();
    });

    it('creates an account the first time a new identity signs in', async () => {
      m.accounts.findByProviderAccount.mockResolvedValue(null);
      m.users.findByEmail.mockResolvedValue(null);
      m.accounts.createUserWithAccount.mockResolvedValue(buildUser());

      await service.complete('google', 'code', 'state', CONTEXT);

      const [user, account] = m.accounts.createUserWithAccount.mock.calls[0] as [
        { email: string; displayName: string },
        { providerAccountId: string },
      ];
      expect(user).toEqual({ email: 'sam@example.com', displayName: 'Sam Ben Ali' });
      expect(account.providerAccountId).toBe('google-sub-123');
    });

    it('falls back to the address when the provider sends no name', async () => {
      googleProvider.exchangeCode.mockResolvedValue({ ...IDENTITY, displayName: undefined });
      m.accounts.findByProviderAccount.mockResolvedValue(null);
      m.users.findByEmail.mockResolvedValue(null);
      m.accounts.createUserWithAccount.mockResolvedValue(buildUser());

      await service.complete('google', 'code', 'state', CONTEXT);

      const [user] = m.accounts.createUserWithAccount.mock.calls[0] as [{ displayName: string }, unknown];
      expect(user.displayName).toBe('sam');
    });

    /**
     * The policy decision this feature turns on. Email verification does not
     * exist yet, so a local account's address is unproven — merging on a match
     * would hand whoever registered it a shared account with the real owner.
     */
    it('refuses to merge into an existing password account', async () => {
      m.accounts.findByProviderAccount.mockResolvedValue(null);
      m.users.findByEmail.mockResolvedValue(buildUser({ passwordHash: '$argon2id$...' }));

      await expect(service.complete('google', 'code', 'state', CONTEXT)).rejects.toThrow(
        new ConflictException(OAUTH_ERRORS.emailTaken),
      );

      expect(m.accounts.createUserWithAccount).not.toHaveBeenCalled();
      expect(m.accounts.create).not.toHaveBeenCalled();
      expect(m.auth.startSessionFor).not.toHaveBeenCalled();
    });

    it('resolves the identity by subject id, not by email', async () => {
      // The person changed their address at Google. The link must still be
      // theirs, and a stranger who later acquires the old address must not
      // inherit the account.
      const user = buildUser({ email: 'old@example.com' });
      m.accounts.findByProviderAccount.mockResolvedValue({
        ...buildAccount({ email: 'old@example.com' }),
        user,
      });

      await service.complete('google', 'code', 'state', CONTEXT);

      expect(m.users.findByEmail).not.toHaveBeenCalled();
      expect(m.auth.startSessionFor).toHaveBeenCalledWith(user, CONTEXT);
      // ...and the recorded address is brought up to date.
      expect(m.accounts.touchEmail).toHaveBeenCalledWith('link-1', 'sam@example.com');
    });
  });

  describe('complete — linking', () => {
    beforeEach(() => {
      m.states.consume.mockResolvedValue({
        provider: 'google',
        codeVerifier: 'v',
        returnTo: '/settings',
        linkUserId: 'user-1',
      });
    });

    it('attaches the provider without starting a new session', async () => {
      m.accounts.findByProviderAccount.mockResolvedValue(null);

      const result = await service.complete('google', 'code', 'state', CONTEXT);

      expect(m.accounts.create).toHaveBeenCalledWith({
        userId: 'user-1',
        provider: 'GOOGLE',
        providerAccountId: 'google-sub-123',
        email: 'sam@example.com',
      });
      // The caller is already signed in; issuing a second session would rotate
      // them onto a new family for no reason.
      expect(result.session).toBeUndefined();
      expect(m.auth.startSessionFor).not.toHaveBeenCalled();
    });

    it('is a no-op when it is already linked to the same account', async () => {
      m.accounts.findByProviderAccount.mockResolvedValue({
        ...buildAccount({ userId: 'user-1' }),
        user: buildUser(),
      });

      await service.complete('google', 'code', 'state', CONTEXT);

      expect(m.accounts.create).not.toHaveBeenCalled();
    });

    it('refuses an identity already linked to someone else', async () => {
      m.accounts.findByProviderAccount.mockResolvedValue({
        ...buildAccount({ userId: 'someone-else' }),
        user: buildUser({ id: 'someone-else' }),
      });

      await expect(service.complete('google', 'code', 'state', CONTEXT)).rejects.toThrow(ConflictException);
    });
  });

  describe('unlink', () => {
    it('refuses to remove the only way into an account', async () => {
      // Signed up with Google, never set a password: removing this locks them
      // out for good, because password reset needs email delivery we lack.
      m.users.findById.mockResolvedValue(buildUser({ passwordHash: null }));
      m.accounts.findForUser.mockResolvedValue([buildAccount()]);

      await expect(service.unlink('user-1', 'GOOGLE')).rejects.toThrow(ConflictException);
      expect(m.accounts.deleteForUser).not.toHaveBeenCalled();
    });

    it('allows it when a password remains', async () => {
      m.users.findById.mockResolvedValue(buildUser({ passwordHash: '$argon2id$...' }));
      m.accounts.findForUser.mockResolvedValue([buildAccount()]);

      await service.unlink('user-1', 'GOOGLE');

      expect(m.accounts.deleteForUser).toHaveBeenCalledWith('user-1', 'GOOGLE');
    });

    it('allows it when another provider remains', async () => {
      m.users.findById.mockResolvedValue(buildUser({ passwordHash: null }));
      m.accounts.findForUser.mockResolvedValue([
        buildAccount(),
        buildAccount({ id: 'link-2', provider: 'APPLE', providerAccountId: 'apple-sub' }),
      ]);

      await service.unlink('user-1', 'GOOGLE');

      expect(m.accounts.deleteForUser).toHaveBeenCalledWith('user-1', 'GOOGLE');
    });
  });
});
