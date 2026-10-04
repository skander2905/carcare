'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api/client';
import { accountEmailApi } from '@/lib/auth/account-email-api';

/**
 * Where "Stop these emails" lands. A button, not an automatic action: mail
 * scanners open links, and must not unsubscribe anyone by doing so.
 */
export function UnsubscribeConfirm() {
  const token = useSearchParams().get('token') ?? '';
  const stop = useMutation({ mutationFn: () => accountEmailApi.unsubscribe(token) });

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl">
          {stop.isSuccess ? 'Emails stopped' : 'Stop reminder emails?'}
        </CardTitle>
        <CardDescription>
          {stop.isSuccess
            ? "You won't get reminder emails any more. They still appear under the bell in the app."
            : 'Reminders will still appear under the bell in the app.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {stop.isSuccess ? null : (
          <Button className="w-full" disabled={!token || stop.isPending} onClick={() => stop.mutate()}>
            {stop.isPending ? 'Stopping…' : 'Stop reminder emails'}
          </Button>
        )}
        {stop.isError ? (
          <p role="alert" className="text-destructive text-sm">
            {stop.error instanceof ApiError ? stop.error.message : 'Something went wrong. Try again.'}
          </p>
        ) : null}
        <p className="text-muted-foreground text-center text-sm">
          You can turn them back on in{' '}
          <Link href="/settings" className="underline underline-offset-4">
            Settings
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
