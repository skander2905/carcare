import { type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { type AuthenticatedUser } from '../auth.types.js';

/**
 * Applied globally (see `AuthModule`), so every route is protected unless it
 * carries `@Public()`.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    // Checked on the handler first, then the controller, so a whole controller
    // can be public and an individual route inside it still protected.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    return super.canActivate(context);
  }

  /**
   * Collapses every failure mode — no header, malformed token, expired token,
   * wrong audience — into one message.
   *
   * Distinguishing "expired" from "invalid" here would tell an attacker
   * probing with forged tokens which of their guesses was structurally correct.
   * The client does not need the distinction either: it refreshes on any 401.
   */
  override handleRequest<TUser = AuthenticatedUser>(err: unknown, user: TUser | false): TUser {
    if (err || !user) {
      throw new UnauthorizedException('Authentication required');
    }
    return user;
  }
}
