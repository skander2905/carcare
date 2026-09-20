import { createHash, randomBytes } from 'node:crypto';

/**
 * PKCE (RFC 7636).
 *
 * The verifier stays on the server; only its hash travels to the provider in
 * the authorization request. An attacker who intercepts the authorization code
 * — from a redirect logged by a proxy, say — cannot exchange it without the
 * verifier, which never left this process.
 *
 * Google does not require PKCE for a confidential client holding a secret, but
 * it costs two hashes and removes a whole class of code-interception attack.
 */
export function createCodeVerifier(): string {
  // RFC 7636 allows 43-128 characters; 32 bytes of base64url is 43.
  return randomBytes(32).toString('base64url');
}

export function codeChallengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * The `state` parameter: unguessable, single-use, and tied to one browser.
 *
 * It is what makes a callback attributable. Without it anyone can hand a victim
 * a crafted callback URL and sign them into an account the attacker controls —
 * login CSRF, which is how an attacker gets a victim to file their data into
 * the attacker's account.
 */
export function createState(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Where to send the browser once the callback is done.
 *
 * Only a path is ever accepted. `returnTo` arrives from the query string, so an
 * absolute URL here would turn the callback into an open redirect on a page the
 * user has just been taught to trust.
 */
export function safeReturnPath(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  // A single leading slash, so `//evil.example` — a protocol-relative URL that
  // looks like a path — is rejected too.
  return /^\/(?!\/)/.test(raw) ? raw : fallback;
}
