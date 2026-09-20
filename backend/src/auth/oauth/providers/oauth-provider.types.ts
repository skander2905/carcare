import { type OAuthProvider } from '../../../generated/prisma/enums.js';

/** What a provider tells us about the person who just signed in. */
export interface ProviderIdentity {
  /** The provider's stable subject id. This — not the email — is the identity. */
  providerAccountId: string;
  email: string;
  /** Whether the provider asserts it verified the address. */
  emailVerified: boolean;
  displayName?: string;
}

export interface AuthorizationRequest {
  url: string;
  /** PKCE verifier, held server-side until the callback presents the code. */
  codeVerifier: string;
}

/**
 * One identity provider.
 *
 * Deliberately narrow, and deliberately not "an OAuth client": everything
 * provider-specific — how the client secret is produced, which scopes are
 * asked for, how the ID token's claims are spelled — stays behind this
 * interface. Apple differs from Google in all three (its secret is an ES256
 * JWT that expires, and its callback is a form POST), and this is the seam
 * that keeps those differences from leaking into the controller.
 */
export interface IdentityProvider {
  readonly id: OAuthProvider;
  /** Lower-case name used in URLs: `/auth/oauth/google`. */
  readonly slug: string;
  readonly displayName: string;

  /** Where to send the browser, plus the PKCE verifier to remember. */
  buildAuthorizationRequest(state: string): AuthorizationRequest;

  /** Exchange the callback's code and return the verified identity. */
  exchangeCode(code: string, codeVerifier: string): Promise<ProviderIdentity>;
}
