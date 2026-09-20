import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/** 256 bits of entropy — unguessable, and short enough for a cookie. */
const TOKEN_BYTES = 32;

/** SHA-256 as lowercase hex is exactly 64 characters, matching `Char(64)`. */
export const TOKEN_HASH_LENGTH = 64;

/**
 * Refresh tokens are opaque random strings, not JWTs.
 *
 * There is nothing to read inside one: the server looks it up, so it carries no
 * claims that could go stale and needs no signature to verify. That also means
 * revocation is a row update rather than a distributed cache of deny-listed
 * JWT ids.
 */
export function generateOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function newFamilyId(): string {
  return randomUUID();
}

/**
 * Only the hash is stored, so a database leak yields nothing replayable.
 *
 * A plain SHA-256 is right here and a password hash would be wrong: the input is
 * already 256 bits of uniform randomness, so there is no dictionary to attack
 * and no reason to pay Argon2's cost on the hot refresh path.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison for hex digests of equal length. */
export function tokenHashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

const MS_PER_DAY = 86_400_000;

export function refreshTokenExpiry(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + days * MS_PER_DAY);
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/**
 * Whether an already-rotated token is a concurrent refresh rather than a replay.
 *
 * Two browser tabs can present the same token milliseconds apart; treating the
 * loser as an attacker would log the user out for using the product normally.
 * Outside the grace window there is no benign explanation, so the caller revokes
 * the whole family. See docs/decisions.md ADR-005 and ADR-010.
 */
export function isWithinReuseGrace(revokedAt: Date, graceMs: number, now: Date = new Date()): boolean {
  return now.getTime() - revokedAt.getTime() <= graceMs;
}
