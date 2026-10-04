import { api } from '@/lib/api/client';

/** None of these need a session, and a 401 must not trigger a token refresh. */
const PUBLIC = { skipAuthRefresh: true } as const;

export const accountEmailApi = {
  verify: (token: string) =>
    api.post<{ verified: true }>('/auth/email/verify', { body: { token }, ...PUBLIC }),
  resendVerification: () => api.post<void>('/auth/email/verify/resend'),
  forgotPassword: (email: string) => api.post<void>('/auth/password/forgot', { body: { email }, ...PUBLIC }),
  resetPassword: (token: string, password: string) =>
    api.post<{ reset: true }>('/auth/password/reset', { body: { token, password }, ...PUBLIC }),
  unsubscribe: (token: string) =>
    api.post<{ unsubscribed: true }>('/notifications/unsubscribe', { query: { token }, ...PUBLIC }),
};
