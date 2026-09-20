import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/client';
import { authApi } from './auth-api';
import { endSession, refreshSession } from './session';
import { getAccessToken } from './token-store';

vi.mock('./auth-api', () => ({
  authApi: { refresh: vi.fn() },
}));

const refreshMock = vi.mocked(authApi.refresh);

function unauthorized(): ApiError {
  return new ApiError({ statusCode: 401, message: 'Session expired', error: 'Unauthorized' });
}

/** A refresh that resolves only when the test says so. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('refreshSession', () => {
  beforeEach(() => {
    endSession();
    refreshMock.mockReset();
  });

  afterEach(() => {
    endSession();
  });

  it('stores the new access token', async () => {
    refreshMock.mockResolvedValue({ accessToken: 'fresh-token', expiresIn: 900 });

    await expect(refreshSession()).resolves.toBe(true);
    expect(getAccessToken()).toBe('fresh-token');
  });

  it('reports failure and clears the token when the session is over', async () => {
    refreshMock.mockRejectedValue(unauthorized());

    await expect(refreshSession()).resolves.toBe(false);
    expect(getAccessToken()).toBeNull();
  });

  describe('single flight', () => {
    it('rotates once no matter how many callers ask at the same time', async () => {
      const gate = deferred<{ accessToken: string; expiresIn: number }>();
      refreshMock.mockReturnValue(gate.promise);

      // Three components hit a 401 in the same tick — the everyday case for a
      // dashboard that fires several queries at once.
      const callers = [refreshSession(), refreshSession(), refreshSession()];
      gate.resolve({ accessToken: 'fresh-token', expiresIn: 900 });

      await expect(Promise.all(callers)).resolves.toEqual([true, true, true]);

      // Two rotations would present the same refresh token twice, which the
      // server cannot distinguish from a stolen-token replay — it would revoke
      // the family and sign the user out. See ADR-010.
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });

    it('starts a new rotation once the previous one has settled', async () => {
      refreshMock.mockResolvedValue({ accessToken: 'first', expiresIn: 900 });
      await refreshSession();

      refreshMock.mockResolvedValue({ accessToken: 'second', expiresIn: 900 });
      await refreshSession();

      // Otherwise the very first refresh's answer would be cached forever and
      // the session could never be renewed again.
      expect(refreshMock).toHaveBeenCalledTimes(2);
      expect(getAccessToken()).toBe('second');
    });

    it('does not cache a failure either', async () => {
      refreshMock.mockRejectedValueOnce(unauthorized());
      await expect(refreshSession()).resolves.toBe(false);

      refreshMock.mockResolvedValueOnce({ accessToken: 'recovered', expiresIn: 900 });
      await expect(refreshSession()).resolves.toBe(true);
    });
  });
});

describe('endSession during a refresh', () => {
  /**
   * Signing out on a shared machine has to stay signed out. Clearing the
   * in-flight promise does not cancel the request, so without a generation
   * check the response would land afterwards and restore a working token.
   */
  it('ignores a refresh that lands after sign-out', async () => {
    const gate = deferred<{ accessToken: string; expiresIn: number }>();
    refreshMock.mockReturnValue(gate.promise);

    const pending = refreshSession();
    endSession();
    gate.resolve({ accessToken: 'too-late', expiresIn: 900 });

    await expect(pending).resolves.toBe(false);
    expect(getAccessToken()).toBeNull();
  });

  it('lets a refresh started after sign-out succeed', async () => {
    const stale = deferred<{ accessToken: string; expiresIn: number }>();
    refreshMock.mockReturnValueOnce(stale.promise);

    const abandoned = refreshSession();
    endSession();

    refreshMock.mockResolvedValueOnce({ accessToken: 'fresh', expiresIn: 900 });
    await expect(refreshSession()).resolves.toBe(true);

    // The abandoned one settling must not wipe the newer session.
    stale.resolve({ accessToken: 'too-late', expiresIn: 900 });
    await abandoned;

    expect(getAccessToken()).toBe('fresh');
  });
});

describe('endSession', () => {
  it('drops the local token', async () => {
    refreshMock.mockResolvedValue({ accessToken: 'fresh-token', expiresIn: 900 });
    await refreshSession();

    endSession();

    expect(getAccessToken()).toBeNull();
  });
});
