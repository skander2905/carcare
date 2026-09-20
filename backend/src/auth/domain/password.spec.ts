import { describe, expect, it } from 'vitest';
import { dummyPasswordHash, hashPassword, verifyPassword } from './password.js';

describe('hashPassword', () => {
  it('produces an argon2id hash', () => {
    // The `$argon2id$` prefix is what proves the variant actually in use; the
    // options object is easy to get wrong silently.
    return expect(hashPassword('correct horse battery staple')).resolves.toMatch(/^\$argon2id\$/);
  });

  it('salts, so the same password never yields the same hash twice', async () => {
    const [first, second] = await Promise.all([hashPassword('same password'), hashPassword('same password')]);

    expect(first).not.toBe(second);
  });

  it('encodes the cost parameters in the hash so they can be raised later', async () => {
    expect(await hashPassword('whatever')).toContain('m=19456,t=2,p=1');
  });
});

describe('verifyPassword', () => {
  it('accepts the password it was built from', async () => {
    const stored = await hashPassword('correct horse battery staple');

    expect(await verifyPassword(stored, 'correct horse battery staple')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple');

    expect(await verifyPassword(stored, 'Correct horse battery staple')).toBe(false);
  });

  it('returns false rather than throwing on a corrupt stored hash', async () => {
    // A truncated column must read as "wrong password", not as a 500 that
    // distinguishes this row from every other failed login.
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
    expect(await verifyPassword('', 'anything')).toBe(false);
  });
});

describe('dummyPasswordHash', () => {
  it('is computed once and reused', async () => {
    expect(await dummyPasswordHash()).toBe(await dummyPasswordHash());
  });

  it('is a real argon2 hash, so verifying against it costs what a real one costs', async () => {
    const dummy = await dummyPasswordHash();

    expect(dummy).toMatch(/^\$argon2id\$/);
    // And nothing verifies against it, so it can never be a way in.
    expect(await verifyPassword(dummy, 'carcare-timing-equaliser ')).toBe(false);
  });
});
