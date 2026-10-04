'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/features/auth/use-auth';
import { api, ApiError } from '@/lib/api/client';
import { accountEmailApi } from '@/lib/auth/account-email-api';
import { type AuthUser } from '@/lib/auth/types';

type State = { kind: 'working' } | { kind: 'done' } | { kind: 'failed'; message: string };

/** Opened from the emailed link: confirms straight away, then says so. */
export function VerifyEmailResult() {
  const token = useSearchParams().get('token') ?? '';
  const { status, adoptProfile } = useAuth();
  const [state, setState] = useState<State>(
    token ? { kind: 'working' } : { kind: 'failed', message: 'This page needs the link from your email.' },
  );
  // React runs effects twice in development; a link works once, so the second run must not send it again.
  const sent = useRef(false);

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    accountEmailApi.verify(token).then(
      () => setState({ kind: 'done' }),
      (failure: unknown) =>
        setState({
          kind: 'failed',
          message: failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.',
        }),
    );
  }, [token]);

  // Signed in on this browser: refresh the account so the "confirm your email" banner goes away.
  useEffect(() => {
    if (state.kind === 'done' && status === 'authenticated') {
      void api.get<AuthUser>('/auth/me').then(adoptProfile, () => undefined);
    }
  }, [state.kind, status, adoptProfile]);

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl">
          {state.kind === 'done'
            ? 'Email confirmed'
            : state.kind === 'failed'
              ? 'Link not valid'
              : 'Confirming…'}
        </CardTitle>
        <CardDescription>
          {state.kind === 'done'
            ? 'Thanks. CarCare can now email you reminders.'
            : state.kind === 'failed'
              ? state.message
              : 'One moment.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state.kind === 'working' ? (
          <Loader2 className="text-muted-foreground size-5 animate-spin" aria-hidden />
        ) : (
          <Button asChild className="w-full">
            <Link href={status === 'authenticated' ? '/dashboard' : '/login'}>
              {status === 'authenticated' ? 'Go to CarCare' : 'Sign in'}
            </Link>
          </Button>
        )}
        {state.kind === 'failed' && status === 'authenticated' ? (
          <p className="text-muted-foreground mt-3 text-center text-sm">
            You can ask for a new link in{' '}
            <Link href="/settings" className="underline">
              Settings
            </Link>
            .
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
