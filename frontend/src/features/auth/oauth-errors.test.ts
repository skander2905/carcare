import { describe, expect, it } from 'vitest';
import { oauthErrorMessage } from './oauth-errors';

describe('oauthErrorMessage', () => {
  it('says nothing when the callback reported nothing', () => {
    expect(oauthErrorMessage(null)).toBeNull();
  });

  it('tells the user what to do about a taken email, not just that it failed', () => {
    const message = oauthErrorMessage('oauth_email_taken')!;

    // The refusal is only defensible if the way forward is stated — otherwise
    // it reads as "your account exists but you cannot use it".
    expect(message).toMatch(/password/i);
    expect(message).toMatch(/settings/i);
  });

  it('explains an expired or reused sign-in link', () => {
    expect(oauthErrorMessage('oauth_state')).toMatch(/expired|already been used|already used/i);
  });

  it('covers an identity already attached elsewhere', () => {
    expect(oauthErrorMessage('oauth_already_linked')).toMatch(/already connected/i);
  });

  it('still says something for a code it does not recognise', () => {
    // A new code added on the server must never leave the user on a silent
    // login page wondering what happened.
    expect(oauthErrorMessage('something_new_from_the_api')).toMatch(/try again/i);
  });
});
