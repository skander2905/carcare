'use client';

import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setTokenProvider, setUnauthorizedHandler } from '@/lib/api/client';
import { authApi } from '@/lib/auth/auth-api';
import { endSession, refreshSession } from '@/lib/auth/session';
import { getAccessToken, setAccessToken } from '@/lib/auth/token-store';
import { type AuthSession, type AuthUser, type LoginInput, type RegisterInput } from '@/lib/auth/types';

/*
 * Wired at module scope, not in an effect.
 *
 * This module is imported by the root layout, so the transport is configured
 * before any component renders. Doing it in `useEffect` would leave a window in
 * which the first request of the first paint goes out with no Authorization
 * header and no refresh-on-401.
 */
setTokenProvider(getAccessToken);
setUnauthorizedHandler(refreshSession);

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Adopts a profile the caller has just saved.
   *
   * The signed-in user is held here, so a successful `PATCH /users/me` that
   * only resets its own form leaves the greeting and the account menu showing
   * the old name until a full reload.
   */
  adoptProfile: (user: AuthUser) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  /**
   * Recovers a session on a cold load.
   *
   * The access token was in memory and is gone, but the httpOnly refresh cookie
   * survived — so one `/auth/refresh` is what turns a page reload back into a
   * signed-in user. Failing is the normal path for a visitor who is simply not
   * signed in, so it is not an error state.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const recovered = await refreshSession();

      if (!recovered) {
        if (!cancelled) setStatus('unauthenticated');
        return;
      }

      try {
        const profile = await authApi.me();
        if (!cancelled) {
          setUser(profile);
          setStatus('authenticated');
        }
      } catch {
        // The token refreshed but the profile read failed — treat the session
        // as unusable rather than showing a signed-in shell with no user.
        endSession();
        if (!cancelled) setStatus('unauthenticated');
      }
    })();

    // A reload or a fast sign-out can unmount this before the round trip ends;
    // setting state afterwards would resurrect a session that is already over.
    return () => {
      cancelled = true;
    };
  }, []);

  const adopt = useCallback((session: AuthSession) => {
    setAccessToken(session);
    setUser(session.user);
    setStatus('authenticated');
  }, []);

  const login = useCallback(
    async (input: LoginInput) => {
      adopt(await authApi.login(input));
    },
    [adopt],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      adopt(await authApi.register(input));
    },
    [adopt],
  );

  const logout = useCallback(async () => {
    try {
      // Revokes the token family server-side. A failure here (offline, say)
      // must still clear the local session — refusing to log out because the
      // network is down is the wrong answer on a shared machine.
      await authApi.logout();
    } finally {
      endSession();
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  const adoptProfile = useCallback((updated: AuthUser) => {
    setUser(updated);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, register, logout, adoptProfile }),
    [user, status, login, register, logout, adoptProfile],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
