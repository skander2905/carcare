import { type AccessTokenPayload } from './types';

/**
 * The access token lives here — in a module variable, in memory, and nowhere
 * else.
 *
 * Not `localStorage`, not `sessionStorage`, not a readable cookie: all three
 * are readable by any script on the page, so a single XSS turns into a stolen
 * session. The cost is that a page reload loses it, which is exactly what
 * `/auth/refresh` is for — the httpOnly cookie survives the reload and no
 * script can read *that*.
 */
let accessToken: string | null = null;
let expiresAt = 0;

/** Refreshed this early before the real expiry, so a request in flight when the
    token turns 15 minutes old does not fail on a technicality. */
const EXPIRY_SKEW_MS = 30_000;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(payload: AccessTokenPayload | null): void {
  if (!payload) {
    accessToken = null;
    expiresAt = 0;
    return;
  }

  accessToken = payload.accessToken;
  expiresAt = Date.now() + payload.expiresIn * 1_000;
}

/** True when there is a token and it is not about to expire. */
export function hasFreshAccessToken(): boolean {
  return accessToken !== null && Date.now() < expiresAt - EXPIRY_SKEW_MS;
}

export function clearAccessToken(): void {
  setAccessToken(null);
}
