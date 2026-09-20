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
 * An open redirect is the classic bug in a `?next=` parameter: a crafted
 * `?next=https://evil.example` turns our own login page into a convincing
 * stepping stone. Only a path beginning with a single slash is accepted, which
 * also rules out protocol-relative `//evil.example`.
 */
export function safeNext(raw: string | null): string {
  if (!raw) return DEFAULT_DESTINATION;
  return /^\/(?!\/)/.test(raw) ? raw : DEFAULT_DESTINATION;
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
