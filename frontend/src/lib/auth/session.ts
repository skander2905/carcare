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

/**
 * Bumped whenever the session ends.
 *
 * Clearing `inFlight` does not cancel the request already in the air. Without a
 * generation to compare against, a refresh that was mid-flight when the user
 * signed out would still call `setAccessToken` when it landed — quietly putting
 * a working token back into a session that is supposed to be over, on a machine
 * someone has just walked away from.
 */
let generation = 0;

async function rotate(startedAt: number): Promise<boolean> {
  try {
    const payload = await authApi.refresh();

    // The session ended while this was in flight; its answer belongs to a
    // session that no longer exists.
    if (startedAt !== generation) return false;

    setAccessToken(payload);
    return true;
  } catch {
    // A 401 is the ordinary "not signed in" answer on a cold load, not a fault.
    // Anything else (network, 500) is equally unrecoverable here, and the
    // caller decides what to show.
    if (startedAt === generation) clearAccessToken();
    return false;
  }
}

/**
 * Obtains a fresh access token, reusing a refresh that is already running.
 * Resolves `true` when a usable token is now in the store.
 */
export function refreshSession(): Promise<boolean> {
  const startedAt = generation;

  inFlight ??= rotate(startedAt).finally(() => {
    // Only retire this flight if it is still the current one — a newer refresh
    // started after a sign-out must not be cleared by an older one settling.
    if (startedAt === generation) inFlight = null;
  });

  return inFlight;
}

/** Drops the local session. The server-side revocation is `authApi.logout`. */
export function endSession(): void {
  generation += 1;
  inFlight = null;
  clearAccessToken();
}
