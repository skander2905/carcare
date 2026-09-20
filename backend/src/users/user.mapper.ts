import { type UserResponse } from '../auth/dto/auth.response.js';
import { type User } from '../prisma/model.types.js';

/**
 * The only route from a database row to a response body.
 *
 * Written as an explicit allow-list: adding a column to `User` — a password
 * reset token, an internal flag — cannot leak it into an API response, because
 * a field that is not named here simply does not travel. An `@Exclude()`-style
 * deny-list has the opposite failure mode, where forgetting one decorator is a
 * disclosure.
 */
export function toUserResponse(user: User): UserResponse {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    currency: user.currency,
    locale: user.locale,
    timezone: user.timezone,
    createdAt: user.createdAt.toISOString(),
  };
}
