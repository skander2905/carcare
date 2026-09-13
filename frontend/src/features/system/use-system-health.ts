'use client';

import { useQuery } from '@tanstack/react-query';
import { env } from '@/lib/env';

export type DependencyStatus = 'up' | 'degraded' | 'down';

export interface HealthDetail {
  status: DependencyStatus;
  responseTimeMs?: number;
  message?: string;
}

export interface HealthResponse {
  status: 'ok' | 'error' | 'shutting_down';
  details: Record<string, HealthDetail>;
}

/**
 * Polls the API's aggregate health probe.
 *
 * Hits `${origin}/health` rather than the versioned API base: probe URLs stay
 * stable across API versions precisely so monitoring never breaks on a release.
 */
export function useSystemHealth() {
  return useQuery({
    queryKey: ['system', 'health'],
    queryFn: async ({ signal }): Promise<HealthResponse> => {
      const response = await fetch(`${env.apiOrigin}/health`, { signal });

      // Terminus answers 503 with a full body when a dependency is down; that
      // is a successful measurement, not a failed request.
      const body = (await response.json()) as HealthResponse;
      return body;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });
}
