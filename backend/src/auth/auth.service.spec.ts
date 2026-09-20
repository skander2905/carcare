import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { type JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthConfig } from '../config/config.types.js';
import { type User } from '../prisma/model.types.js';
import { type UsersService } from '../users/users.service.js';
import { AuthService, type SessionContext } from './auth.service.js';
import { hashPassword } from './domain/password.js';
import { hashToken } from './domain/tokens.js';
import { type RefreshTokenRepository } from './refresh-token.repository.js';

const CONTEXT: SessionContext = { userAgent: 'vitest', ipAddress: '127.0.0.1' };
const PASSWORD = 'correct horse battery staple';

const AUTH_CONFIG = {
  accessSecret: 'a-test-signing-key-of-at-least-32-characters',
  accessTtl: '15m',
  issuer: 'carcare',
  audience: 'carcare-api',
  refreshTtlDays: 30,
  cookieName: 'carcare_refresh_token',
  cookieDomain: undefined,
  cookieSecure: false,
  reuseGraceMs: 10_000,
  rateLimitEnabled: true,
} satisfies AuthConfig;

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'sam@example.com',
    passwordHash: 'replaced-per-test',
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

function buildTokenRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'token-1',
    userId: 'user-1',
    tokenHash: hashToken('presented-token'),
    familyId: 'family-1',
    expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null,
    userAgent: null,
    ipAddress: null,
    createdAt: new Date(),
    ...overrides,
  };
}

/** A refresh-token row as the repository would return it. */
type TokenRow = ReturnType<typeof buildTokenRow>;

/**
 * Explicit signatures rather than a bare `vi.fn()`.
 *
 * The loose default types every mock as returning `void`, which makes each
 * promise-returning implementation below look like a dropped promise — and
 * costs the real type checking these tests are supposed to get.
 */
const buildMocks = () => ({
  users: {
    create: vi.fn<(data: { email: string; passwordHash: string; displayName: string }) => Promise<User>>(),
    findByEmail: vi.fn<(email: string) => Promise<User | null>>(),
    findById: vi.fn<(id: string) => Promise<User | null>>(),
  },
  refreshTokens: {
    create: vi.fn<(data: Record<string, unknown>) => Promise<TokenRow>>(),
    findByHash: vi.fn<(hash: string) => Promise<TokenRow | null>>(),
    rotate: vi.fn<(id: string, replacement: Record<string, unknown>) => Promise<TokenRow | null>>(),
    revokeFamily: vi.fn<(familyId: string) => Promise<number>>(),
    hasLiveToken: vi.fn<(familyId: string) => Promise<boolean>>(),
  },
  jwt: {
    signAsync: vi.fn<(payload: unknown) => Promise<string>>(),
    decode: vi.fn<(token: string) => { iat: number; exp: number }>(),
  },
});

describe('AuthService', () => {
  let users: ReturnType<typeof buildMocks>['users'];
  let refreshTokens: ReturnType<typeof buildMocks>['refreshTokens'];
  let jwt: ReturnType<typeof buildMocks>['jwt'];
  let service: AuthService;

  beforeEach(() => {
    ({ users, refreshTokens, jwt } = buildMocks());

    refreshTokens.create.mockImplementation((data) => Promise.resolve(data as TokenRow));
    refreshTokens.revokeFamily.mockResolvedValue(1);
    // The default is a session that is still running; the tests that care
    // about an ended one say so explicitly.
    refreshTokens.hasLiveToken.mockResolvedValue(true);
    jwt.signAsync.mockResolvedValue('signed.access.token');
    // 15 minutes, matching the configured TTL.
    jwt.decode.mockReturnValue({ iat: 1_000, exp: 1_900 });

    service = new AuthService(
      users as unknown as UsersService,
      refreshTokens as unknown as RefreshTokenRepository,
      jwt as unknown as JwtService,
      AUTH_CONFIG,
    );
  });

  describe('register', () => {
    it('stores a hash, never the password itself', async () => {
      users.create.mockImplementation((data) => Promise.resolve(buildUser(data)));

      await service.register({ email: 'sam@example.com', password: PASSWORD, displayName: 'Sam' }, CONTEXT);

      const stored = users.create.mock.calls[0][0];
      expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
      expect(stored.passwordHash).not.toContain(PASSWORD);
    });

    it('opens a fresh token family, unconnected to any other session', async () => {
      users.create.mockResolvedValue(buildUser());

      await service.register({ email: 'sam@example.com', password: PASSWORD, displayName: 'Sam' }, CONTEXT);

      const row = refreshTokens.create.mock.calls[0][0] as { familyId: string; userId: string };
      expect(row.familyId).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.userId).toBe('user-1');
    });

    it('lets a duplicate email surface as a conflict', async () => {
      users.create.mockRejectedValue(new ConflictException('taken'));

      await expect(
        service.register({ email: 'sam@example.com', password: PASSWORD, displayName: 'Sam' }, CONTEXT),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('login', () => {
    it('issues a session for correct credentials', async () => {
      users.findByEmail.mockResolvedValue(buildUser({ passwordHash: await hashPassword(PASSWORD) }));

      const session = await service.login({ email: 'sam@example.com', password: PASSWORD }, CONTEXT);

      expect(session.accessToken).toBe('signed.access.token');
      expect(session.expiresIn).toBe(900);
      expect(session.user.id).toBe('user-1');
    });

    it('rejects a wrong password', async () => {
      users.findByEmail.mockResolvedValue(buildUser({ passwordHash: await hashPassword(PASSWORD) }));

      await expect(
        service.login({ email: 'sam@example.com', password: 'wrong password!!' }, CONTEXT),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('gives an unknown address exactly the same answer as a wrong password', async () => {
      const knownUser = buildUser({ passwordHash: await hashPassword(PASSWORD) });

      users.findByEmail.mockResolvedValueOnce(null);
      const unknownEmail = await service
        .login({ email: 'nobody@example.com', password: PASSWORD }, CONTEXT)
        .catch((error: Error) => error);

      users.findByEmail.mockResolvedValueOnce(knownUser);
      const wrongPassword = await service
        .login({ email: 'sam@example.com', password: 'wrong password!!' }, CONTEXT)
        .catch((error: Error) => error);

      // Identical message and status: the login form must not double as a way
      // to find out which addresses are registered.
      expect(unknownEmail).toBeInstanceOf(UnauthorizedException);
      expect((unknownEmail as Error).message).toBe((wrongPassword as Error).message);
    });

    it('never issues a token when the account does not exist', async () => {
      users.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: PASSWORD }, CONTEXT),
      ).rejects.toThrow(UnauthorizedException);

      expect(refreshTokens.create).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('rotates a live token and returns the new plaintext, not its hash', async () => {
      const row = buildTokenRow();
      refreshTokens.findByHash.mockResolvedValue(row);
      refreshTokens.rotate.mockImplementation((_id, replacement) =>
        Promise.resolve({ ...(replacement as TokenRow), id: 'token-2' }),
      );
      users.findById.mockResolvedValue(buildUser());

      const session = await service.refresh('presented-token', CONTEXT);

      const written = refreshTokens.rotate.mock.calls[0][1] as { tokenHash: string; familyId: string };
      // The invariant the whole scheme rests on: what the client receives must
      // hash to what was stored, and must not itself be the stored value.
      expect(hashToken(session.refreshToken)).toBe(written.tokenHash);
      expect(session.refreshToken).not.toBe(written.tokenHash);
      // A rotation continues the session, so the family is unchanged.
      expect(written.familyId).toBe('family-1');
    });

    it('rejects a token that was never issued, without revoking anything', async () => {
      refreshTokens.findByHash.mockResolvedValue(null);

      await expect(service.refresh('who-knows', CONTEXT)).rejects.toThrow(UnauthorizedException);
      expect(refreshTokens.revokeFamily).not.toHaveBeenCalled();
    });

    it('rejects an expired token', async () => {
      refreshTokens.findByHash.mockResolvedValue(buildTokenRow({ expiresAt: new Date(Date.now() - 1_000) }));

      await expect(service.refresh('presented-token', CONTEXT)).rejects.toThrow(UnauthorizedException);
      expect(refreshTokens.rotate).not.toHaveBeenCalled();
    });

    it('revokes the whole family when an old token is replayed', async () => {
      refreshTokens.findByHash.mockResolvedValue(
        // Rotated an hour ago: far outside any plausible tab race.
        buildTokenRow({ revokedAt: new Date(Date.now() - 3_600_000) }),
      );
      // The session is still running, which is what makes this a theft rather
      // than a stale cookie.
      refreshTokens.hasLiveToken.mockResolvedValue(true);

      await expect(service.refresh('presented-token', CONTEXT)).rejects.toThrow(UnauthorizedException);

      expect(refreshTokens.revokeFamily).toHaveBeenCalledWith('family-1');
      expect(refreshTokens.create).not.toHaveBeenCalled();
    });

    it('treats a rotation from within the grace window as the same refresh', async () => {
      refreshTokens.findByHash.mockResolvedValue(buildTokenRow({ revokedAt: new Date(Date.now() - 2_000) }));
      users.findById.mockResolvedValue(buildUser());

      const session = await service.refresh('presented-token', CONTEXT);

      // Two tabs refreshing at once must not log the user out.
      expect(refreshTokens.revokeFamily).not.toHaveBeenCalled();
      const row = refreshTokens.create.mock.calls[0][0] as { familyId: string; tokenHash: string };
      expect(row.familyId).toBe('family-1');
      expect(hashToken(session.refreshToken)).toBe(row.tokenHash);
    });

    it('refuses a spent token once the session has been logged out', async () => {
      refreshTokens.findByHash.mockResolvedValue(
        // Rotated a second ago — well inside the grace window.
        buildTokenRow({ revokedAt: new Date(Date.now() - 1_000) }),
      );
      // Logout revoked every token in the family, so nothing is live.
      refreshTokens.hasLiveToken.mockResolvedValue(false);

      await expect(service.refresh('presented-token', CONTEXT)).rejects.toThrow(UnauthorizedException);

      // Recency alone must not resurrect an ended session, or logging out on a
      // shared machine would be undone by anyone holding a just-spent token.
      expect(refreshTokens.create).not.toHaveBeenCalled();
    });

    it('does not report an ended session as a replay attack', async () => {
      refreshTokens.findByHash.mockResolvedValue(
        buildTokenRow({ revokedAt: new Date(Date.now() - 3_600_000) }),
      );
      refreshTokens.hasLiveToken.mockResolvedValue(false);

      await expect(service.refresh('presented-token', CONTEXT)).rejects.toThrow(UnauthorizedException);

      // Nothing left to revoke, and an old cookie from last week's logout is
      // not an incident worth paging anyone about.
      expect(refreshTokens.revokeFamily).not.toHaveBeenCalled();
    });

    it('recovers when a concurrent request wins the rotation race', async () => {
      refreshTokens.findByHash.mockResolvedValue(buildTokenRow());
      // `null` is how the repository reports "already revoked by someone else"
      // between our read and our conditional update.
      refreshTokens.rotate.mockResolvedValue(null);
      users.findById.mockResolvedValue(buildUser());

      const session = await service.refresh('presented-token', CONTEXT);

      expect(refreshTokens.revokeFamily).not.toHaveBeenCalled();
      expect(session.accessToken).toBe('signed.access.token');
    });

    it('refuses a valid token whose user has since been deleted', async () => {
      refreshTokens.findByHash.mockResolvedValue(buildTokenRow());
      refreshTokens.rotate.mockImplementation((_id, replacement) => Promise.resolve(replacement as TokenRow));
      users.findById.mockResolvedValue(null);

      await expect(service.refresh('presented-token', CONTEXT)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('ends every session in the family', async () => {
      refreshTokens.findByHash.mockResolvedValue(buildTokenRow());

      await service.logout('presented-token');

      expect(refreshTokens.revokeFamily).toHaveBeenCalledWith('family-1');
    });

    it('is a no-op without a token, rather than an error', async () => {
      await expect(service.logout(undefined)).resolves.toBeUndefined();
      expect(refreshTokens.findByHash).not.toHaveBeenCalled();
    });

    it('is a no-op for an unknown token', async () => {
      refreshTokens.findByHash.mockResolvedValue(null);

      await expect(service.logout('stale-token')).resolves.toBeUndefined();
      expect(refreshTokens.revokeFamily).not.toHaveBeenCalled();
    });
  });
});
