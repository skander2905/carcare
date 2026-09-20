import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '@/lib/api/client';
import { authErrorMessage } from './auth-error';

const apiError = (statusCode: number, message: string, details: string[] = []) =>
  new ApiError({ statusCode, message, error: 'Error', details });

describe('authErrorMessage', () => {
  it('explains a network failure in terms the user can act on', () => {
    expect(authErrorMessage(new NetworkError())).toMatch(/connection/i);
  });

  it('keeps the credentials message ambiguous', () => {
    // It must not become more specific than the server's own answer, or the UI
    // reintroduces the account-enumeration leak the API works to avoid.
    expect(authErrorMessage(apiError(401, 'Invalid email or password'))).toBe('Invalid email or password.');
  });

  it('names the conflict on a duplicate registration', () => {
    expect(authErrorMessage(apiError(409, 'taken'))).toMatch(/already exists/i);
  });

  it('passes the rate-limit message through, since it says when to retry', () => {
    expect(authErrorMessage(apiError(429, 'Too many attempts. Try again in 42 seconds.'))).toMatch(
      /42 seconds/,
    );
  });

  it('surfaces the first field error on a validation failure', () => {
    expect(authErrorMessage(apiError(400, 'Validation failed', ['password is too short']))).toBe(
      'password is too short',
    );
  });

  it('falls back to something safe for an unrecognised failure', () => {
    expect(authErrorMessage(new Error('boom'))).toMatch(/went wrong/i);
  });
});
