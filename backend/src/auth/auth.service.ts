import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { authConfig } from '../config/configuration.js';
import { type AuthConfig } from '../config/config.types.js';
import { type User } from '../prisma/model.types.js';
import { UsersService } from '../users/users.service.js';
import { type AccessTokenPayload } from './auth.types.js';
import { dummyPasswordHash, hashPassword, verifyPassword } from './domain/password.js';
import {
  generateOpaqueToken,
  hashToken,
  isExpired,
  isWithinReuseGrace,
  newFamilyId,
  refreshTokenExpiry,
} from './domain/tokens.js';
import { type LoginDto, type RegisterDto } from './dto/credentials.dto.js';
import { RefreshTokenRepository } from './refresh-token.repository.js';

/** Where the request came from, recorded against the session for auditing. */
export interface SessionContext {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Everything a successful authentication produces. The plaintext refresh token
 * appears here and nowhere else — the controller puts it straight into the
 * cookie, and only its hash reaches the database.
 */
export interface IssuedSession {
  user: User;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * One message for every failed credential check.
 *
 * "No such account" and "wrong password" must be indistinguishable, or the
 * login form doubles as an oracle telling an attacker which addresses are
 * registered — useful for credential stuffing and for phishing the rest.
 */
const INVALID_CREDENTIALS = 'Invalid email or password';

/** Deliberately vague, for the same reason: it never says why. */
const INVALID_SESSION = 'Your session has expired. Please sign in again.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly jwt: JwtService,
    @Inject(authConfig.KEY) private readonly auth: AuthConfig,
  ) {}

  async register(dto: RegisterDto, context: SessionContext): Promise<IssuedSession> {
    const passwordHash = await hashPassword(dto.password);

    // A duplicate email surfaces as a 409 from UsersService, which is safe to
    // reveal here: registration necessarily tells you whether an address is
    // taken, so hiding it would only break the form.
    const user = await this.users.create({
      email: dto.email,
      passwordHash,
      displayName: dto.displayName,
    });

    return this.startSession(user, context);
  }

  async login(dto: LoginDto, context: SessionContext): Promise<IssuedSession> {
    const user = await this.users.findByEmail(dto.email);

    // Verify against a throwaway hash when the account does not exist — or has
    // no password because it was created through a provider — so every path
    // costs the same ~50ms of Argon2. Skipping it would make those cases
    // measurably faster and leak exactly what the shared message hides.
    const storedHash = user?.passwordHash ?? (await dummyPasswordHash());
    const passwordMatches = await verifyPassword(storedHash, dto.password);

    if (!user || !passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return this.startSession(user, context);
  }

  /**
   * Rotates a refresh token, and detects replay.
   *
   * The three outcomes for a presented token:
   *
   * - **live** — revoked and replaced by a successor in the same family.
   * - **already rotated, within the grace window** — two tabs refreshed at
   *   once. Treated as the same logical refresh: a new token is issued and
   *   nobody is logged out. See ADR-010.
   * - **already rotated, outside it** — two parties hold the same token and
   *   only one of them is the legitimate user. There is no way to tell which,
   *   so the entire family dies and both must sign in again. See ADR-005.
   */
  async refresh(presentedToken: string, context: SessionContext): Promise<IssuedSession> {
    const record = await this.refreshTokens.findByHash(hashToken(presentedToken));

    // An unknown token was never issued here, or belongs to a family already
    // deleted. Nothing to revoke.
    if (!record) throw new UnauthorizedException(INVALID_SESSION);

    if (isExpired(record.expiresAt)) throw new UnauthorizedException(INVALID_SESSION);

    if (record.revokedAt) {
      // Recency alone does not make a spent token benign. A logout and a replay
      // revocation both revoke the whole family, and a token rotated moments
      // before either of those is still "recently revoked" — so grace on its
      // own would hand out a fresh token for a session that was deliberately
      // ended. Whether a live sibling remains is what tells a session that is
      // still running from one that is over, and `continueSession` asks that
      // question and inserts in the same transaction rather than in two steps.
      if (isWithinReuseGrace(record.revokedAt, this.auth.reuseGraceMs)) {
        const continued = await this.continueSession(record.userId, record.familyId, context);
        if (continued) return continued;

        // The family died — logged out, or revoked by an earlier replay. Not an
        // incident, just an old cookie.
        throw new UnauthorizedException(INVALID_SESSION);
      }

      // Outside the window. If anything in the family was still live, two
      // parties held this token and only one of them is the real user; a count
      // of zero means the session was already over and there is no attack to
      // report.
      const revoked = await this.refreshTokens.revokeFamily(record.familyId);

      if (revoked > 0) {
        this.logger.warn(
          `Refresh token replay detected for user ${record.userId}; revoked ${revoked} token(s) in family ${record.familyId}`,
        );
      }

      throw new UnauthorizedException(INVALID_SESSION);
    }

    // Build the successor up front so the plaintext stays in hand: only its
    // hash is written, and this is the one moment the real token exists.
    const replacement = this.buildTokenRecord(record.userId, record.familyId, context);
    const rotated = await this.refreshTokens.rotate(record.id, replacement.record);

    // Lost the race to a concurrent refresh between the read and the update.
    // Same benign case as the grace window above, caught one step later — and
    // subject to the same liveness check, so a logout landing in between
    // cannot be undone here either.
    if (!rotated) {
      const continued = await this.continueSession(record.userId, record.familyId, context);
      if (continued) return continued;

      throw new UnauthorizedException(INVALID_SESSION);
    }

    const user = await this.requireUser(record.userId);
    return this.issue(user, replacement.plaintext, replacement.record.expiresAt);
  }

  /**
   * Ends the session the presented token belongs to, on every device sharing
   * that family.
   *
   * Never throws. Logging out is not an operation a user should be able to
   * fail at: an unknown, expired or missing token means they are already
   * logged out, and the controller clears the cookie regardless.
   */
  async logout(presentedToken: string | undefined): Promise<void> {
    if (!presentedToken) return;

    const record = await this.refreshTokens.findByHash(hashToken(presentedToken));
    if (!record) return;

    await this.refreshTokens.revokeFamily(record.familyId);
  }

  /** Current profile, read fresh — a token's claims can be up to 15 minutes stale. */
  async profile(userId: string): Promise<User> {
    return this.requireUser(userId);
  }

  /**
   * Issues a session for a user who has already been authenticated some other
   * way — today, by an identity provider.
   *
   * Public so the OAuth flow produces exactly the session a password login
   * does: same access token, same rotating family, same cookie. Everything
   * downstream then has one notion of a session rather than two.
   */
  startSessionFor(user: User, context: SessionContext): Promise<IssuedSession> {
    return this.startSession(user, context);
  }

  // -- internals ------------------------------------------------------------

  /** A login or registration: a brand-new family, unrelated to any other session. */
  private async startSession(user: User, context: SessionContext): Promise<IssuedSession> {
    const { plaintext, record } = this.buildTokenRecord(user.id, newFamilyId(), context);
    await this.refreshTokens.create(record);

    return this.issue(user, plaintext, record.expiresAt);
  }

  /**
   * A concurrent refresh: same family, new token, nothing revoked.
   *
   * Returns `null` when the family turned out to be over, which the repository
   * decides and acts on atomically — so a logout cannot slip between the check
   * and the insert.
   */
  private async continueSession(
    userId: string,
    familyId: string,
    context: SessionContext,
  ): Promise<IssuedSession | null> {
    const { plaintext, record } = this.buildTokenRecord(userId, familyId, context);

    const created = await this.refreshTokens.createIfFamilyLive(record);
    if (!created) return null;

    const user = await this.requireUser(userId);
    return this.issue(user, plaintext, record.expiresAt);
  }

  private buildTokenRecord(userId: string, familyId: string, context: SessionContext) {
    const plaintext = generateOpaqueToken();

    return {
      plaintext,
      record: {
        userId,
        familyId,
        tokenHash: hashToken(plaintext),
        expiresAt: refreshTokenExpiry(this.auth.refreshTtlDays),
        // Truncated to the column widths rather than trusted: a client controls
        // both of these headers and an over-long one would fail the insert.
        ...(context.userAgent ? { userAgent: context.userAgent.slice(0, 512) } : {}),
        ...(context.ipAddress ? { ipAddress: context.ipAddress.slice(0, 64) } : {}),
      },
    };
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.users.findById(userId);

    // The token is valid but its subject is gone — a deleted account whose
    // cascade has not caught up, or a restored database. Not a 404: as far as
    // the caller is concerned the session is simply no longer usable.
    if (!user) throw new UnauthorizedException(INVALID_SESSION);

    return user;
  }

  private async issue(user: User, refreshToken: string, refreshExpiresAt: Date): Promise<IssuedSession> {
    const { accessToken, expiresIn } = await this.signAccessToken(user);
    return { user, accessToken, expiresIn, refreshToken, refreshExpiresAt };
  }

  private async signAccessToken(user: User): Promise<{ accessToken: string; expiresIn: number }> {
    const payload: AccessTokenPayload = { sub: user.id, email: user.email, role: user.role };

    const accessToken = await this.jwt.signAsync(payload);

    // Read the lifetime back off the token rather than parsing the `15m`
    // configuration string a second time, so the advertised `expiresIn` cannot
    // drift from the token's actual `exp`.
    const decoded = this.jwt.decode<{ exp?: number; iat?: number } | null>(accessToken);
    const expiresIn = decoded?.exp && decoded.iat ? decoded.exp - decoded.iat : 0;

    return { accessToken, expiresIn };
  }
}
