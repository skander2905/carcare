'use client';

import { use } from 'react';
import { AuthContext, type AuthContextValue } from './auth-provider';

/**
 * Throws outside the provider rather than returning a null-ish default: a
 * component that silently believes nobody is signed in is a much harder bug to
 * find than one that fails on first render.
 */
export function useAuth(): AuthContextValue {
  const context = use(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }

  return context;
}
