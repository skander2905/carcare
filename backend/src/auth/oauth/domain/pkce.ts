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
 * Validated by **resolving** it against the web app's own origin, not by
 * pattern-matching the string. A regex has to out-guess the WHATWG URL parser,
 * and it loses: `/\evil.example` is an off-site URL because the parser treats
 * a backslash as a separator, and `/<tab>/evil.example` is one because the
 * parser strips tab, newline and carriage return from anywhere in the input
 * before it parses. Every one of those passes a "starts with a single slash"
 * check.
 *
 * Resolving with the same parser that will later build the redirect closes the
 * gap by construction: any quirk applies to both, so there is nothing left to
 * disagree about. The **normalised** path is returned rather than the caller's
 * string, so what gets stored is already canonical.
 */
export function safeReturnPath(raw: string | undefined, fallback: string, webAppUrl: string): string {
  if (!raw) return fallback;

  try {
    const base = new URL(webAppUrl);
    const resolved = new URL(raw, base);

    if (resolved.origin !== base.origin) return fallback;

    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    // An unparseable base or a value the parser rejects outright.
    return fallback;
  }
}
