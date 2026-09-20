/**
 * Wording for the `?error=` codes the OAuth callback redirects with.
 *
 * The callback is a browser navigation, so a failure cannot come back as a JSON
 * body. The API sends a short code and the phrasing lives here, where it can be
 * translated and where it can say what to do next — which the API, redirecting
 * a browser it knows nothing about, cannot.
 */
const MESSAGES: Record<string, string> = {
  oauth_email_taken:
    'That email already has a password account. Sign in with your password, then connect the provider from settings.',
  oauth_state: 'That sign-in link has expired or was already used. Please try again.',
  oauth_already_linked: 'That account is already connected to a different CarCare account.',
  oauth_failed: 'Sign-in could not be completed. Please try again.',
};

export function oauthErrorMessage(code: string | null): string | null {
  if (!code) return null;
  // An unrecognised code still gets a message: silence would leave the person
  // back on the login page with no idea why.
  return MESSAGES[code] ?? MESSAGES.oauth_failed!;
}
