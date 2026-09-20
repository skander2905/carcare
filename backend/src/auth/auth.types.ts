import { type UserRole } from '../generated/prisma/enums.js';

/**
 * What a validated access token proves, and the only identity information any
 * downstream handler is allowed to trust.
 *
 * Note what is *not* here: no display name, no currency, nothing a user can
 * change. A token minted before a profile edit would carry stale values, so
 * anything mutable is read from the database at the point of use instead.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

/** Claims carried by the signed access token. */
export interface AccessTokenPayload {
  /** Subject — the user id. */
  sub: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

/** `req.user` once `JwtAuthGuard` has run. */
export interface RequestWithUser {
  user?: AuthenticatedUser;
}
