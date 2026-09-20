'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ProviderMark } from '@/features/auth/provider-mark';
import { ApiError } from '@/lib/api/client';
import { oauthApi, startOAuthLink } from '@/lib/auth/oauth';
import { type ConnectedAccount, type IdentityProvider } from '@/lib/auth/types';

const CONNECTED_KEY = ['auth', 'connected-accounts'];

function connectionFor(
  provider: IdentityProvider,
  connected: ConnectedAccount[] | undefined,
): ConnectedAccount | undefined {
  return connected?.find((account) => account.provider.toLowerCase() === provider.slug);
}

export function ConnectedAccounts() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const providers = useQuery({
    queryKey: ['auth', 'providers'],
    queryFn: () => oauthApi.available(),
    staleTime: Infinity,
    retry: false,
  });

  const connected = useQuery({
    queryKey: CONNECTED_KEY,
    queryFn: () => oauthApi.connected(),
  });

  const disconnect = useMutation({
    mutationFn: (slug: string) => oauthApi.disconnect(slug),
    onSuccess: async () => {
      toast.success('Disconnected');
      await queryClient.invalidateQueries({ queryKey: CONNECTED_KEY });
    },
    onError: (error: unknown) => {
      // The API refuses to remove the only way into an account. That is the one
      // error here worth quoting verbatim — it explains what to do instead.
      toast.error(error instanceof ApiError ? error.message : 'Could not disconnect that account.');
    },
  });

  if (providers.isLoading || connected.isLoading) {
    return <Skeleton className="h-44 w-full" />;
  }

  if (!providers.data?.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Connected accounts</CardTitle>
        <CardDescription>
          Sign in with a provider instead of your password. Connecting one never changes what your password
          does.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {providers.data.map((provider) => {
          const link = connectionFor(provider, connected.data);

          return (
            <div
              key={provider.slug}
              className="border-border flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <ProviderMark slug={provider.slug} className="size-5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{provider.displayName}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {link ? (link.email ?? 'Connected') : 'Not connected'}
                  </p>
                </div>
              </div>

              {link ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disconnect.isPending}
                  onClick={() => disconnect.mutate(provider.slug)}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending !== null}
                  onClick={() => {
                    setPending(provider.slug);
                    // Navigates away on success; on failure the page stays, so
                    // the pending state has to be released.
                    startOAuthLink(provider.slug, '/settings').catch(() => {
                      setPending(null);
                      toast.error(`Could not start ${provider.displayName} sign-in.`);
                    });
                  }}
                >
                  {pending === provider.slug ? 'Redirecting…' : 'Connect'}
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
