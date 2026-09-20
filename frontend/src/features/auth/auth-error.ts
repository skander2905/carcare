import { ApiError, NetworkError } from '@/lib/api/client';

/**
 * Turns a failed auth call into something worth showing a person.
 *
 * The server's messages are deliberately vague for security reasons — one
 * message for "no such account" and "wrong password" — so this mostly passes
 * them through, and only steps in where the raw message would be unhelpful.
 */
export function authErrorMessage(error: unknown): string {
  if (error instanceof NetworkError) {
    return 'Could not reach CarCare. Check your connection and try again.';
  }

  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return 'Invalid email or password.';
      case 409:
        return 'An account with that email address already exists.';
      case 429:
        // The server sends a Retry-After, but the number matters less than the
        // reassurance that this is a cool-down and not a rejection.
        return error.message || 'Too many attempts. Please wait a moment and try again.';
      case 400:
        return error.details[0] ?? error.message;
      default:
        return error.message;
    }
  }

  return 'Something went wrong. Please try again.';
}
