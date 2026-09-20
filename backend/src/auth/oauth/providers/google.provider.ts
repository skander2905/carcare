import { UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { OAuthProvider } from '../../../generated/prisma/enums.js';
import { codeChallengeFor, createCodeVerifier } from '../domain/pkce.js';
import {
  type AuthorizationRequest,
  type IdentityProvider,
  type ProviderIdentity,
} from './oauth-provider.types.js';

/**
 * Google's endpoints, from its OpenID discovery document.
 *
 * Hard-coded rather than fetched at boot: they have not changed in a decade,
 * and fetching them would make the API's startup depend on Google being
 * reachable. The JWKS *is* fetched, because those keys rotate by design.
 */
const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/** Only what is needed to identify the person. No Drive, no contacts. */
const SCOPES = ['openid', 'email', 'profile'];

/** Claims we rely on from Google's ID token. */
interface GoogleIdTokenClaims {
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  given_name?: string;
}

interface TokenResponse {
  id_token?: string;
  error?: string;
  error_description?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface GoogleProviderOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class GoogleProvider implements IdentityProvider {
  readonly id = OAuthProvider.GOOGLE;
  readonly slug = 'google';
  readonly displayName = 'Google';

  /**
   * Cached across requests and refreshed by `jose` when it sees an unknown key
   * id. Building it per request would fetch Google's key set on every sign-in.
   */
  private readonly jwks = createRemoteJWKSet(new URL(JWKS_URI));

  constructor(private readonly options: GoogleProviderOptions) {}

  buildAuthorizationRequest(state: string): AuthorizationRequest {
    const codeVerifier = createCodeVerifier();

    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.searchParams.set('client_id', this.options.clientId);
    url.searchParams.set('redirect_uri', this.options.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallengeFor(codeVerifier));
    url.searchParams.set('code_challenge_method', 'S256');
    // No refresh token is requested: this is sign-in, not delegated access to
    // the user's Google data, so there is nothing to call Google for later.
    url.searchParams.set('access_type', 'online');
    // Always show the account chooser, so a shared browser does not silently
    // reuse whoever signed in last.
    url.searchParams.set('prompt', 'select_account');

    return { url: url.toString(), codeVerifier };
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<ProviderIdentity> {
    const idToken = await this.requestIdToken(code, codeVerifier);
    return this.verifyIdToken(idToken);
  }

  private async requestIdToken(code: string, codeVerifier: string): Promise<string> {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        redirect_uri: this.options.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }),
    }).catch(() => {
      throw new UnauthorizedException('Could not reach Google to complete sign-in');
    });

    const payload: unknown = await response.json().catch(() => undefined);
    const body = (isRecord(payload) ? payload : {}) as TokenResponse;

    if (!response.ok || !body.id_token) {
      // The provider's own error text is not shown to the user: an expired or
      // replayed code is indistinguishable to them from any other failure, and
      // the detail belongs in the logs.
      throw new UnauthorizedException('Google sign-in could not be completed');
    }

    return body.id_token;
  }

  private async verifyIdToken(idToken: string): Promise<ProviderIdentity> {
    // Signature, issuer, audience and expiry are all checked here. Skipping any
    // one of them would accept a token minted for a different application —
    // which is exactly how "sign in with Google" gets turned into "sign in as
    // anyone".
    const { payload } = await jwtVerify(idToken, this.jwks, {
      issuer: ISSUERS,
      audience: this.options.clientId,
    }).catch(() => {
      throw new UnauthorizedException('Google sign-in could not be verified');
    });

    const claims = payload as GoogleIdTokenClaims;

    if (!claims.sub || !claims.email) {
      throw new UnauthorizedException('Google did not return an email address');
    }

    // Google sends a boolean, but the claim is specified as possibly a string;
    // comparing loosely would make the string "false" verified.
    const emailVerified = claims.email_verified === true || claims.email_verified === 'true';

    if (!emailVerified) {
      // Without this, a Google Workspace admin could set any address on an
      // account they control and use it to claim someone else's identity.
      throw new UnauthorizedException('Your Google email address is not verified');
    }

    // Omitted entirely when absent or blank, so the caller's `??` fallback
    // fires rather than storing an empty display name.
    const displayName = (claims.name ?? claims.given_name ?? '').trim();

    return {
      providerAccountId: claims.sub,
      email: claims.email.trim().toLowerCase(),
      emailVerified,
      ...(displayName ? { displayName } : {}),
    };
  }
}
