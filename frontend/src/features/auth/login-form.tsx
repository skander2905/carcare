'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { authErrorMessage } from './auth-error';
import { AuthFormShell } from './auth-form-shell';
import { FormField } from './form-field';
import { oauthErrorMessage } from './oauth-errors';
import { ProviderButtons } from './provider-buttons';
import { loginSchema, type LoginValues } from './auth-schemas';
import { useAuth } from './use-auth';

/** Only same-origin paths are honoured — see `safeNext`. */
const DEFAULT_DESTINATION = '/dashboard';

/**
 * Where to land after signing in.
 *
 * Validated by **resolving** against this page's own origin rather than by
 * matching the string. A "starts with one slash" regex loses to the WHATWG URL
 * parser: `/\evil.example` is off-site because a backslash is a separator, and
 * `/<tab>/evil.example` is off-site because tab, newline and carriage return
 * are stripped from anywhere in the input before parsing. Both look like paths.
 *
 * This is the same rule the API applies to the OAuth `returnTo`, for the same
 * reason — a real login page that forwards somewhere else afterwards is far
 * more convincing than any lookalike domain.
 */
export function safeNext(raw: string | null, origin?: string): string {
  if (!raw) return DEFAULT_DESTINATION;

  const base = origin ?? (typeof window === 'undefined' ? 'http://localhost' : window.location.origin);

  try {
    const from = new URL(base);
    const resolved = new URL(raw, from);

    if (resolved.origin !== from.origin) return DEFAULT_DESTINATION;

    // Normalised, so what is handed on is already canonical.
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return DEFAULT_DESTINATION;
  }
}

export function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);

  // A failed provider sign-in redirects back here with a code rather than a
  // response body, since the callback is a navigation and not a fetch.
  const callbackError = oauthErrorMessage(searchParams.get('error'));

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    try {
      await login(values);
      router.replace(safeNext(searchParams.get('next')));
    } catch (error) {
      setFormError(authErrorMessage(error));
    }
  });

  return (
    <AuthFormShell
      title="Sign in"
      description="Pick up where you left off."
      footerPrompt="New to CarCare?"
      footerHref="/register"
      footerLabel="Create an account"
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          // The first field of the first screen: focus belongs here.
          autoFocus
          placeholder="you@example.com"
          error={errors.email?.message}
          {...register('email')}
        />

        <FormField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />

        {(formError ?? callbackError) ? (
          // role="alert" so the failure is announced, not merely displayed.
          <p role="alert" className="text-destructive text-sm">
            {formError ?? callbackError}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <ProviderButtons action="signin" returnTo={safeNext(searchParams.get('next'))} />
    </AuthFormShell>
  );
}
