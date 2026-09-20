import { ApiError } from '@/lib/api/client';
import { authApi } from './auth-api';
import { clearAccessToken, setAccessToken } from './token-store';

/**
 * The single in-flight refresh.
 *
 * Every refresh on the server rotates the token and revokes the old one, so two
 * simultaneous refreshes would present the same token twice and look exactly
 * like a stolen-token replay — which would revoke the whole family and sign the
 * user out for having two tabs open. Funnelling them through one promise means
 * the second caller waits for the first rather than starting a second rotation.
 *
 * See docs/decisions.md ADR-005 and ADR-010.
 */
let inFlight: Promise<boolean> | null = null;

async function rotate(): Promise<boolean> {
  try {
    const payload = await authApi.refresh();
    setAccessToken(payload);
    return true;
  } catch (error) {
    // A 401 is the ordinary "not signed in" answer on a cold load, not a fault.
    // Anything else (network, 500) is also unrecoverable here, and the caller
    // decides what to show.
    clearAccessToken();
    if (error instanceof ApiError && error.isUnauthorized) return false;
    return false;
  }
}

/**
 * Obtains a fresh access token, reusing a refresh that is already running.
 * Resolves `true` when a usable token is now in the store.
 */
export function refreshSession(): Promise<boolean> {
  inFlight ??= rotate().finally(() => {
    // Cleared only once settled, so the *next* 401 starts a new rotation
    // rather than reusing this one's answer forever.
    inFlight = null;
  });

  return inFlight;
}

/** Drops the local session. The server-side revocation is `authApi.logout`. */
export function endSession(): void {
  inFlight = null;
  clearAccessToken();
}
