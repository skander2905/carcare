import { describe, expect, it } from 'vitest';
import { signUnsubscribe, verifyUnsubscribe } from './unsubscribe-link.js';

const KEY = 'a-signing-key-of-at-least-32-characters!';
const USER = '0192f8c1-2b3d-7e4f-8a9b-1c2d3e4f5a6b';

describe('unsubscribe links', () => {
  it('names the user it was made for', () => {
    expect(verifyUnsubscribe(signUnsubscribe(USER, KEY), KEY)).toBe(USER);
  });

  it('refuses a link pointed at someone else', () => {
    const [, signature] = signUnsubscribe(USER, KEY).split('.');
    const other = Buffer.from('0192f8c1-0000-7e4f-8a9b-1c2d3e4f5a6b').toString('base64url');
    expect(verifyUnsubscribe(`${other}.${signature}`, KEY)).toBeNull();
  });

  it('refuses one signed with another key, and anything malformed', () => {
    expect(verifyUnsubscribe(signUnsubscribe(USER, 'another-key-another-key-another-key'), KEY)).toBeNull();
    expect(verifyUnsubscribe('', KEY)).toBeNull();
    expect(verifyUnsubscribe('abc', KEY)).toBeNull();
    expect(verifyUnsubscribe(`${signUnsubscribe(USER, KEY)}.more`, KEY)).toBeNull();
  });
});
