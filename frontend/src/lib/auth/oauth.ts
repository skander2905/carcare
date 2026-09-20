import { api } from '@/lib/api/client';
import { env } from '@/lib/env';
import { type ConnectedAccount, type IdentityProvider } from './types';

export const oauthApi = {
  /** Which buttons to render. An empty list means this deployment is password-only. */
  available: () => api.get<IdentityProvider[]>('/auth/providers', { skipAuthRefresh: true }),

  connected: () => api.get<ConnectedAccount[]>('/auth/oauth'),

  disconnect: (slug: string) => api.delete<void>(`/auth/oauth/${slug}`),

  /** Authorization URL for attaching a provider to the signed-in account. */
  linkUrl: (slug: string, returnTo?: string) =>
    api.get<{ authorizationUrl: string }>(`/auth/oauth/${slug}/link`, {
      ...(returnTo ? { query: { returnTo } } : {}),
    }),
};

/**
 * Hands the browser to the API, which redirects on to the provider.
 *
 * A full navigation rather than `fetch`: the consent screen is a page the
 * person has to see and act on, and an XHR cannot follow a cross-origin
 * redirect into one. It also means the callback's `Set-Cookie` arrives as an
 * ordinary top-level response.
 */
export function startOAuth(slug: string, returnTo?: string): void {
  const url = new URL(`${env.apiUrl}/auth/oauth/${slug}`);
  if (returnTo) url.searchParams.set('returnTo', returnTo);

  window.location.assign(url.toString());
}

/**
 * Same destination, two steps.
 *
 * Linking is authenticated, and a navigation cannot carry a bearer token — so
 * the authorization URL is fetched with the token first, then navigated to.
 */
export async function startOAuthLink(slug: string, returnTo?: string): Promise<void> {
  const { authorizationUrl } = await oauthApi.linkUrl(slug, returnTo);
  window.location.assign(authorizationUrl);
}
