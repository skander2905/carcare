import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { type OAuthProvider } from '../../generated/prisma/enums.js';
import { type OAuthAccount } from '../../prisma/model.types.js';
import { UsersService } from '../../users/users.service.js';
import { AuthService, type IssuedSession, type SessionContext } from '../auth.service.js';
import { createState, safeReturnPath } from './domain/pkce.js';
import { OAuthAccountRepository } from './oauth-account.repository.js';
import { OAuthStateService } from './oauth-state.service.js';
import { ProviderRegistry } from './providers/provider.registry.js';
import { type ProviderIdentity } from './providers/oauth-provider.types.js';

/** Where a sign-in lands when the caller did not ask for somewhere specific. */
const DEFAULT_RETURN_PATH = '/dashboard';

/**
 * Machine-readable outcomes appended to the redirect as `?error=`.
 *
 * The callback is a browser redirect, so a failure cannot be a JSON body — the
 * web app reads these and picks the wording. Codes rather than prose keeps the
 * message in the client, where it can be translated.
 */
export const OAUTH_ERRORS = {
  invalidState: 'oauth_state',
  emailTaken: 'oauth_email_taken',
  failed: 'oauth_failed',
  alreadyLinked: 'oauth_already_linked',
} as const;

export interface StartedFlow {
  authorizationUrl: string;
  state: string;
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly states: OAuthStateService,
    private readonly accounts: OAuthAccountRepository,
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Begins an authorization request.
   *
   * `linkUserId` is carried in the server-side state rather than in the
   * redirect: the browser leaves for Google and comes back without an
   * Authorization header, so who asked for this has to be remembered here.
   * Putting it in the URL would let anyone nominate the account to attach to.
   */
  async start(slug: string, returnTo: string | undefined, linkUserId?: string): Promise<StartedFlow> {
    const provider = this.registry.require(slug);
    const state = createState();
    const { url, codeVerifier } = provider.buildAuthorizationRequest(state);

    await this.states.save(state, {
      provider: slug,
      codeVerifier,
      returnTo: safeReturnPath(returnTo, DEFAULT_RETURN_PATH),
      ...(linkUserId ? { linkUserId } : {}),
    });

    return { authorizationUrl: url, state };
  }

  /**
   * Completes a callback: verifies the state, exchanges the code, and either
   * signs the person in or attaches the provider to their existing account.
   */
  async complete(
    slug: string,
    code: string,
    state: string,
    context: SessionContext,
  ): Promise<{ session?: IssuedSession; returnTo: string }> {
    const pending = await this.states.consume(state);

    // No entry means the state was forged, already used, or expired. All three
    // are the same answer: this callback did not come from a request we started.
    if (pending?.provider !== slug) {
      throw new BadRequestException(OAUTH_ERRORS.invalidState);
    }

    const provider = this.registry.require(slug);
    const identity = await provider.exchangeCode(code, pending.codeVerifier);

    if (pending.linkUserId) {
      await this.link(pending.linkUserId, provider.id, identity);
      // Already signed in — the existing session continues untouched.
      return { returnTo: pending.returnTo };
    }

    const session = await this.signIn(provider.id, identity, context);
    return { session, returnTo: pending.returnTo };
  }

  /** The providers this deployment has credentials for. */
  available(): { slug: string; displayName: string }[] {
    return this.registry.list().map(({ slug, displayName }) => ({ slug, displayName }));
  }

  listForUser(userId: string): Promise<OAuthAccount[]> {
    return this.accounts.findForUser(userId);
  }

  /**
   * Detaches a provider, refusing to leave the account unreachable.
   *
   * Someone who signed up with Google and never set a password has exactly one
   * way in; removing it would lock them out of their own data with no recovery
   * path, since password reset needs an email provider that does not exist yet.
   */
  async unlink(userId: string, provider: OAuthProvider): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('Your session has expired. Please sign in again.');

    const linked = await this.accounts.findForUser(userId);
    const remaining = linked.filter((account) => account.provider !== provider).length;

    if (!user.passwordHash && remaining === 0) {
      throw new ConflictException(
        'This is the only way to sign in to your account. Set a password first, or connect another provider.',
      );
    }

    await this.accounts.deleteForUser(userId, provider);
  }

  // -- internals ------------------------------------------------------------

  private async signIn(
    provider: OAuthProvider,
    identity: ProviderIdentity,
    context: SessionContext,
  ): Promise<IssuedSession> {
    const existing = await this.accounts.findByProviderAccount(provider, identity.providerAccountId);

    if (existing) {
      // Keep the recorded address current: people change it at the provider,
      // and the identity is the subject id, not the email.
      if (existing.email !== identity.email) {
        await this.accounts.touchEmail(existing.id, identity.email);
      }
      return this.auth.startSessionFor(existing.user, context);
    }

    const byEmail = await this.users.findByEmail(identity.email);

    if (byEmail) {
      /*
       * Refuse rather than merge.
       *
       * This API has no email verification yet, so a local account's address is
       * unproven: anyone can register as someone else's address. Auto-linking on
       * a matching email would therefore hand the squatter a shared account with
       * the real owner the moment the owner signed in with Google. Linking is
       * only safe from a session that has already proved it owns the account.
       */
      throw new ConflictException(OAUTH_ERRORS.emailTaken);
    }

    const user = await this.accounts.createUserWithAccount(
      {
        email: identity.email,
        // Providers do not always return a name; the address is a usable
        // stand-in and the person can change it in settings.
        displayName: identity.displayName ?? identity.email.split('@')[0],
      },
      { provider, providerAccountId: identity.providerAccountId, email: identity.email },
    );

    this.logger.log(`Created account ${user.id} from ${provider} sign-in`);

    return this.auth.startSessionFor(user, context);
  }

  private async link(userId: string, provider: OAuthProvider, identity: ProviderIdentity): Promise<void> {
    const existing = await this.accounts.findByProviderAccount(provider, identity.providerAccountId);

    if (existing) {
      // Already attached to this account: linking twice is a no-op, not an error.
      if (existing.userId === userId) return;
      // Attached to somebody else's: one provider identity cannot serve two
      // accounts, or signing in with it would be ambiguous.
      throw new ConflictException(OAUTH_ERRORS.alreadyLinked);
    }

    await this.accounts.create({
      userId,
      provider,
      providerAccountId: identity.providerAccountId,
      email: identity.email,
    });
  }
}
