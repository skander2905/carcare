import { describe, expect, it } from 'vitest';
import {
  TOKEN_HASH_LENGTH,
  generateOpaqueToken,
  hashToken,
  isExpired,
  isWithinReuseGrace,
  newFamilyId,
  refreshTokenExpiry,
  tokenHashesMatch,
} from './tokens.js';

describe('generateOpaqueToken', () => {
  it('produces a URL-safe string with no padding', () => {
    // It travels in a Set-Cookie header, where '+', '/' and '=' all need care.
    expect(generateOpaqueToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 1_000 }, () => generateOpaqueToken()));

    expect(tokens.size).toBe(1_000);
  });

  it('carries 256 bits of entropy', () => {
    // 32 bytes in base64url is 43 characters. A shorter token would be
    // brute-forceable, and this is the assertion that would catch someone
    // "tidying" TOKEN_BYTES down.
    expect(generateOpaqueToken()).toHaveLength(43);
  });
});

describe('hashToken', () => {
  it('fits the Char(64) column exactly', () => {
    expect(hashToken('anything')).toHaveLength(TOKEN_HASH_LENGTH);
  });

  it('is deterministic, so a presented token can be looked up', () => {
    expect(hashToken('same-input')).toBe(hashToken('same-input'));
  });

  it('is not the identity — the plaintext must not be recoverable from storage', () => {
    const token = generateOpaqueToken();

    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).not.toContain(token);
  });

  it('separates tokens differing by one character', () => {
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
  });
});

describe('tokenHashesMatch', () => {
  it('accepts identical digests', () => {
    const digest = hashToken('x');

    expect(tokenHashesMatch(digest, digest)).toBe(true);
  });

  it('rejects different digests', () => {
    expect(tokenHashesMatch(hashToken('x'), hashToken('y'))).toBe(false);
  });

  it('rejects mismatched lengths without throwing', () => {
    // timingSafeEqual throws on unequal lengths; the guard clause exists so a
    // truncated value is a failed comparison rather than a 500.
    expect(tokenHashesMatch('abc', hashToken('x'))).toBe(false);
  });
});

describe('newFamilyId', () => {
  it('is a UUID, matching the uuid column', () => {
    expect(newFamilyId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe('refreshTokenExpiry', () => {
  it('adds whole days to the reference time', () => {
    const now = new Date('2026-09-13T09:00:00.000Z');

    expect(refreshTokenExpiry(30, now).toISOString()).toBe('2026-10-13T09:00:00.000Z');
  });
});

describe('isExpired', () => {
  const now = new Date('2026-09-13T09:00:00.000Z');

  it('is false while the expiry is in the future', () => {
    expect(isExpired(new Date('2026-09-13T09:00:01.000Z'), now)).toBe(false);
  });

  it('is true once the expiry has passed', () => {
    expect(isExpired(new Date('2026-09-13T08:59:59.000Z'), now)).toBe(true);
  });

  it('treats the exact expiry instant as expired', () => {
    // Boundary chosen deliberately: a token is dead *at* its expiry, not one
    // millisecond after it.
    expect(isExpired(now, now)).toBe(true);
  });
});

describe('isWithinReuseGrace', () => {
  const now = new Date('2026-09-13T09:00:10.000Z');

  it('accepts a rotation from a moment ago as the same logical refresh', () => {
    expect(isWithinReuseGrace(new Date('2026-09-13T09:00:05.000Z'), 10_000, now)).toBe(true);
  });

  it('rejects one from outside the window, which is a replay', () => {
    expect(isWithinReuseGrace(new Date('2026-09-13T08:59:00.000Z'), 10_000, now)).toBe(false);
  });

  it('includes the boundary instant', () => {
    expect(isWithinReuseGrace(new Date('2026-09-13T09:00:00.000Z'), 10_000, now)).toBe(true);
  });

  it('treats a zero grace period as "no concurrent refresh is ever benign"', () => {
    expect(isWithinReuseGrace(new Date('2026-09-13T09:00:09.999Z'), 0, now)).toBe(false);
  });
});
