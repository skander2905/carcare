'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AuthFormShell } from '@/features/auth/auth-form-shell';
import { FormField } from '@/features/auth/form-field';
import { ApiError } from '@/lib/api/client';
import { accountEmailApi } from '@/lib/auth/account-email-api';

/** Mirrors the API's rule. */
const PASSWORD_MIN = 12;

export function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({});

  const reset = useMutation({
    mutationFn: () => accountEmailApi.resetPassword(token, password),
    onError: (failure: unknown) =>
      setErrors({ form: failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.' }),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const found: typeof errors = {};
    if (password.length < PASSWORD_MIN) found.password = `Use at least ${PASSWORD_MIN} characters`;
    else if (confirm !== password) found.confirm = "The two passwords don't match";
    setErrors(found);
    if (Object.keys(found).length === 0) reset.mutate();
  };

  return (
    <AuthFormShell
      title="Choose a new password"
      description="You'll be signed out everywhere else."
      footerPrompt="Changed your mind?"
      footerHref="/login"
      footerLabel="Sign in"
    >
      {!token ? (
        <p role="alert" className="text-sm">
          This page needs the link from your email. <Link href="/forgot-password">Ask for a new one</Link>.
        </p>
      ) : reset.isSuccess ? (
        <div role="status" className="space-y-4">
          <p className="text-sm">Your password is changed.</p>
          <Button asChild className="w-full">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormField
            id="password"
            label="New password"
            type="password"
            autoComplete="new-password"
            autoFocus
            value={password}
            error={errors.password}
            hint={`At least ${PASSWORD_MIN} characters. A short sentence works well.`}
            onChange={(event) => setPassword(event.target.value)}
          />
          <FormField
            id="confirm"
            label="Type it again"
            type="password"
            autoComplete="new-password"
            value={confirm}
            error={errors.confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
          {errors.form ? (
            <p role="alert" className="text-destructive text-sm">
              {errors.form}{' '}
              <Link href="/forgot-password" className="underline">
                Get a new link
              </Link>
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={reset.isPending}>
            {reset.isPending ? 'Saving…' : 'Save new password'}
          </Button>
        </form>
      )}
    </AuthFormShell>
  );
}
