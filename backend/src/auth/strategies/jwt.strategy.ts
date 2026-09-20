import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, type StrategyOptionsWithoutRequest } from 'passport-jwt';
import { authConfig } from '../../config/configuration.js';
import { type AuthConfig } from '../../config/config.types.js';
import { type AccessTokenPayload, type AuthenticatedUser } from '../auth.types.js';

/**
 * Validates the bearer access token.
 *
 * Deliberately does **not** load the user from the database. The signature
 * already proves the claims were minted by this API, and a read per request
 * would put the database on the hot path of every single call for a guarantee
 * bounded by a fifteen-minute token lifetime anyway. Revocation is the refresh
 * token's job: a disabled account stops being able to refresh, and its last
 * access token dies on its own within the window.
 *
 * `issuer` and `audience` are verified, not merely set. Without that check a
 * token signed by any other service that happens to share the secret — a
 * staging environment reusing production's key, say — would be accepted here.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@Inject(authConfig.KEY) auth: AuthConfig) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Expired tokens are rejected by the library, not by us.
      ignoreExpiration: false,
      secretOrKey: auth.accessSecret,
      issuer: auth.issuer,
      audience: auth.audience,
      algorithms: ['HS256'],
    } satisfies StrategyOptionsWithoutRequest);
  }

  validate(payload: AccessTokenPayload): AuthenticatedUser {
    // A token missing the claims we rely on is malformed rather than merely
    // unauthorised, but the caller gets the same 401 either way — telling them
    // which claim was wrong only helps someone forging one.
    if (!payload.sub || !payload.email || !payload.role) {
      throw new UnauthorizedException('Invalid access token');
    }

    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
