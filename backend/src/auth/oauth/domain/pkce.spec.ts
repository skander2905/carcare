import { describe, expect, it } from 'vitest';
import { codeChallengeFor, createCodeVerifier, createState, safeReturnPath } from './pkce.js';

describe('createCodeVerifier', () => {
  it('meets RFC 7636: 43-128 unreserved characters', () => {
    const verifier = createCodeVerifier();

    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it('never repeats', () => {
    expect(new Set(Array.from({ length: 500 }, createCodeVerifier)).size).toBe(500);
  });
});

describe('codeChallengeFor', () => {
  it('matches the S256 vector from RFC 7636 appendix B', () => {
    // The spec's own example, so a "simplification" of the encoding fails here
    // rather than silently producing challenges Google rejects.
    expect(codeChallengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('is base64url, never plain base64', () => {
    // '+' and '/' would be mangled in a query string; '=' padding too.
    for (let i = 0; i < 50; i += 1) {
      expect(codeChallengeFor(createCodeVerifier())).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('is deterministic, so the callback can prove it holds the verifier', () => {
    const verifier = createCodeVerifier();

    expect(codeChallengeFor(verifier)).toBe(codeChallengeFor(verifier));
  });
});

describe('createState', () => {
  it('is unguessable and unique', () => {
    expect(new Set(Array.from({ length: 500 }, createState)).size).toBe(500);
    expect(createState()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

/**
 * `returnTo` arrives from the query string and is used in a redirect the user
 * has just been taught to trust, which is the textbook setup for an open
 * redirect.
 */
describe('safeReturnPath', () => {
  const WEB = 'http://localhost:3000';
  const safe = (raw: string | undefined) => safeReturnPath(raw, '/dashboard', WEB);

  it('falls back when nothing was asked for', () => {
    expect(safe(undefined)).toBe('/dashboard');
    expect(safe('')).toBe('/dashboard');
  });

  it('keeps an ordinary in-app path, with its query and fragment', () => {
    expect(safe('/vehicles/123')).toBe('/vehicles/123');
    expect(safe('/vehicles?page=2#top')).toBe('/vehicles?page=2#top');
  });

  it('refuses another origin', () => {
    expect(safe('https://evil.example')).toBe('/dashboard');
    expect(safe('http://evil.example/x')).toBe('/dashboard');
  });

  it('refuses a protocol-relative URL that looks like a path', () => {
    expect(safe('//evil.example')).toBe('/dashboard');
    expect(safe('///evil.example')).toBe('/dashboard');
  });

  /*
   * The bypasses a "starts with a single slash" regex lets through. The WHATWG
   * URL parser treats a backslash as a separator for http(s), and strips tab,
   * newline and carriage return from anywhere in the input before parsing — so
   * each of these resolves to a different origin while looking like a path.
   */
  it('refuses a backslash host', () => {
    expect(safe('/\\evil.example')).toBe('/dashboard');
    expect(safe('\\\\evil.example')).toBe('/dashboard');
  });

  it('refuses a host smuggled past the parser with a control character', () => {
    expect(safe('/\t/evil.example')).toBe('/dashboard');
    expect(safe('/\n/evil.example')).toBe('/dashboard');
    expect(safe('/\r/evil.example')).toBe('/dashboard');
  });

  it('refuses a javascript: destination', () => {
    expect(safe('javascript:alert(1)')).toBe('/dashboard');
  });

  it('normalises what it returns, so nothing is reinterpreted later', () => {
    // The stored value is already canonical, so the redirect that is built
    // from it cannot resolve to something else.
    expect(safe('/a/../vehicles')).toBe('/vehicles');
    expect(safe('http://localhost:3000/vehicles')).toBe('/vehicles');
  });
});
