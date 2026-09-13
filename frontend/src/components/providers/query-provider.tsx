'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api/client';

/**
 * Created inside state rather than at module scope: a module-level client is
 * shared across requests on the server, which would leak one user's cached
 * data into another user's render.
 */
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Vehicle data changes rarely and only through this user's own actions.
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Retrying a 400 or a 403 just wastes a round trip and delays the
          // error the user needs to see.
          if (error instanceof ApiError && error.isClientError) return false;
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === 'development' ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  );
}
