'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { oauthApi, startOAuth } from '@/lib/auth/oauth';
import { ProviderMark } from './provider-mark';

/**
 * Renders a button per configured provider, and nothing at all when the
 * deployment has none.
 *
 * The list comes from the API rather than being hard-coded, so a deployment
 * without Google credentials never shows a button that dead-ends at a
 * misconfiguration the user cannot do anything about.
 */
export function ProviderButtons({ returnTo, action }: { returnTo?: string; action: 'signin' | 'signup' }) {
  const [pending, setPending] = useState<string | null>(null);

  const { data: providers, isLoading } = useQuery({
    queryKey: ['auth', 'providers'],
    queryFn: () => oauthApi.available(),
    // Fixed at deploy time, so there is no reason to ask again this session.
    staleTime: Infinity,
    retry: false,
  });

  if (isLoading) return <Skeleton className="h-9 w-full" />;
  if (!providers?.length) return null;

  const verb = action === 'signup' ? 'Sign up' : 'Sign in';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3" aria-hidden>
        <span className="bg-border h-px flex-1" />
        <span className="text-muted-foreground text-xs">or</span>
        <span className="bg-border h-px flex-1" />
      </div>

      <div className="grid gap-2">
        {providers.map((provider) => (
          <Button
            key={provider.slug}
            type="button"
            variant="outline"
            className="w-full"
            // The navigation leaves this page, so the disabled state is only
            // ever seen for a moment — but without it a double click starts two
            // flows and the first one's state is orphaned in Redis.
            disabled={pending !== null}
            onClick={() => {
              setPending(provider.slug);
              startOAuth(provider.slug, returnTo);
            }}
          >
            <ProviderMark slug={provider.slug} className="size-4" />
            {pending === provider.slug
              ? `Redirecting to ${provider.displayName}…`
              : `${verb} with ${provider.displayName}`}
          </Button>
        ))}
      </div>
    </div>
  );
}
