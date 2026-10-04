'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AuthFormShell } from '@/features/auth/auth-form-shell';
import { FormField } from '@/features/auth/form-field';
import { ApiError } from '@/lib/api/client';
import { accountEmailApi } from '@/lib/auth/account-email-api';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () => accountEmailApi.forgotPassword(email.trim()),
    onError: (failure: unknown) =>
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.'),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Enter the email address you signed up with');
      return;
    }
    send.mutate();
  };

  return (
    <AuthFormShell
      title="Forgot your password?"
      description="We'll email you a link to choose a new one."
      footerPrompt="Remembered it?"
      footerHref="/login"
      footerLabel="Sign in"
    >
      {send.isSuccess ? (
        // The same message whether or not the address has an account: this page must not tell anyone who signed up.
        <p role="status" className="text-sm">
          If <strong>{email.trim()}</strong> has a CarCare account, a link is on its way. It works for 1 hour.
          Check your spam folder if you don&rsquo;t see it.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormField
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            value={email}
            error={error ?? undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button type="submit" className="w-full" disabled={send.isPending}>
            {send.isPending ? 'Sending…' : 'Send me a link'}
          </Button>
        </form>
      )}
    </AuthFormShell>
  );
}
