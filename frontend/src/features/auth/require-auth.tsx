'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from './use-auth';

/**
 * Client-side gate for authenticated pages.
 *
 * This is a **usability** control, not a security one. The access token lives
 * in memory, so there is no way to know on the server whether this visitor is
 * signed in without a round trip — and it would not matter if there were: every
 * endpoint enforces its own authorisation, so the worst a bypass of this
 * component achieves is an empty page full of 401s.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status !== 'unauthenticated') return;

    // Carried through so signing in returns the user to the page they asked
    // for, instead of dumping them on the dashboard.
    const next = encodeURIComponent(pathname);
    router.replace(`/login?next=${next}`);
  }, [status, pathname, router]);

  if (status === 'loading') {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-10 sm:px-6" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  // Render nothing while the redirect is in flight, rather than flashing the
  // protected page to someone who is about to be sent away from it.
  if (status === 'unauthenticated') return null;

  return <>{children}</>;
}
