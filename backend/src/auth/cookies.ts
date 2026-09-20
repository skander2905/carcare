import { type CookieOptions } from 'express';
import { type AuthConfig } from '../config/config.types.js';

/**
 * The cookie is scoped to the auth routes, so it is not attached to every
 * ordinary API call. A credential that only travels where it is actually
 * needed has that much less surface to be logged, proxied or leaked from.
 */
export function refreshCookiePath(globalPrefix: string): string {
  return `/${globalPrefix}/v1/auth`;
}

/**
 * `SameSite=Lax` is sufficient here because the web app and the API are served
 * from the same site (different ports or subdomains still count as same-site).
 * It blocks the cross-site POST that CSRF depends on, which — together with the
 * cookie carrying no authority of its own beyond `/auth` — is why no separate
 * CSRF token is needed for this flow.
 *
 * A genuinely cross-site deployment would need `SameSite=None; Secure` and a
 * CSRF token, and that is a deployment decision, not a code one.
 */
export function refreshCookieOptions(
  auth: AuthConfig,
  globalPrefix: string,
  maxAgeMs?: number,
): CookieOptions {
  return {
    httpOnly: true,
    secure: auth.cookieSecure,
    sameSite: 'lax',
    path: refreshCookiePath(globalPrefix),
    ...(auth.cookieDomain ? { domain: auth.cookieDomain } : {}),
    ...(maxAgeMs === undefined ? {} : { maxAge: maxAgeMs }),
  };
}
