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
  it('falls back when nothing was asked for', () => {
    expect(safeReturnPath(undefined, '/dashboard')).toBe('/dashboard');
    expect(safeReturnPath('', '/dashboard')).toBe('/dashboard');
  });

  it('keeps an ordinary in-app path', () => {
    expect(safeReturnPath('/vehicles/123', '/dashboard')).toBe('/vehicles/123');
  });

  it('refuses another origin', () => {
    expect(safeReturnPath('https://evil.example', '/dashboard')).toBe('/dashboard');
    expect(safeReturnPath('http://evil.example/x', '/dashboard')).toBe('/dashboard');
  });

  it('refuses a protocol-relative URL that looks like a path', () => {
    expect(safeReturnPath('//evil.example', '/dashboard')).toBe('/dashboard');
    expect(safeReturnPath('///evil.example', '/dashboard')).toBe('/dashboard');
  });

  it('refuses a javascript: destination', () => {
    expect(safeReturnPath('javascript:alert(1)', '/dashboard')).toBe('/dashboard');
  });
});
