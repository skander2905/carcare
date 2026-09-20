import { type ExecutionContext, InternalServerErrorException, createParamDecorator } from '@nestjs/common';
import { type AuthenticatedUser, type RequestWithUser } from '../auth.types.js';

/**
 * Injects the authenticated user into a handler parameter.
 *
 * Throwing when it is absent turns a misconfiguration — `@CurrentUser()` on a
 * route that is also `@Public()` — into a loud failure during development
 * rather than an `undefined.id` at runtime, or worse, a query that silently
 * matches everything.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    if (!request.user) {
      throw new InternalServerErrorException(
        'CurrentUser used on a route that is not protected by JwtAuthGuard',
      );
    }

    return request.user;
  },
);
