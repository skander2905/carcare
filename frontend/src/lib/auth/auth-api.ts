import { api } from '@/lib/api/client';
import {
  type AccessTokenPayload,
  type AuthSession,
  type AuthUser,
  type LoginInput,
  type RegisterInput,
} from './types';

/**
 * All four auth calls set `skipAuthRefresh`.
 *
 * They are the refresh mechanism, so letting them trigger it would mean
 * `/auth/refresh` retrying itself forever on a dead session — and a wrong
 * password being reported as an expired one.
 */
const NO_RETRY = { skipAuthRefresh: true } as const;

export const authApi = {
  register: (input: RegisterInput) => api.post<AuthSession>('/auth/register', { body: input, ...NO_RETRY }),

  login: (input: LoginInput) => api.post<AuthSession>('/auth/login', { body: input, ...NO_RETRY }),

  /** Succeeds only if the browser still holds a valid httpOnly refresh cookie. */
  refresh: () => api.post<AccessTokenPayload>('/auth/refresh', NO_RETRY),

  logout: () => api.post<void>('/auth/logout', NO_RETRY),

  me: () => api.get<AuthUser>('/auth/me'),
};
