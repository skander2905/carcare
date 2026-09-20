/** Mirrors the backend's `UserResponse`. */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: 'USER' | 'ADMIN';
  currency: string;
  locale: string;
  timezone: string;
  createdAt: string;
}

export interface AccessTokenPayload {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export interface AuthSession extends AccessTokenPayload {
  user: AuthUser;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput extends LoginInput {
  displayName: string;
}

/** A provider this deployment has credentials for. */
export interface IdentityProvider {
  slug: string;
  displayName: string;
}

/** A provider currently attached to the signed-in account. */
export interface ConnectedAccount {
  provider: 'GOOGLE' | 'APPLE';
  email: string | null;
  connectedAt: string;
}
