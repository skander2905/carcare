'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface ServerFeatures {
  email: boolean;
  files: boolean;
}

/**
 * Which optional features the server has, so the app never offers what would
 * fail — "forgot password" with no email to send it. Asked once per visit.
 * Undefined while loading: callers hide email-only parts until they know.
 */
export function useServerFeatures(): ServerFeatures | undefined {
  return useQuery({
    queryKey: ['server-features'],
    queryFn: () => api.get<ServerFeatures>('/features', { skipAuthRefresh: true }),
    staleTime: Infinity,
    retry: 1,
  }).data;
}
