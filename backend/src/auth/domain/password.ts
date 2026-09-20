import { Algorithm, hash, verify } from '@node-rs/argon2';

/**
 * Argon2id parameters, following the OWASP Password Storage Cheat Sheet:
 * 19 MiB of memory, two passes, one lane.
 *
 * The memory cost is what makes GPU cracking expensive, and it is the knob to
 * raise first if hardware gets cheaper. Changing these values does not
 * invalidate existing hashes — the parameters are encoded in the hash string
 * itself, so `verify` keeps working and only new hashes use the new cost.
 */
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * A pre-computed hash of a value nobody can log in with, used to spend the same
 * CPU time when the email does not exist as when it does.
 *
 * Without it, "no such user" returns in microseconds while a real account takes
 * ~50ms, and that difference alone tells an attacker which addresses are
 * registered. Generated once at module load rather than per request.
 */
let dummyHashPromise: Promise<string> | undefined;

export function dummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= hash('carcare-timing-equaliser', ARGON2_OPTIONS);
  return dummyHashPromise;
}

export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2_OPTIONS);
}

/**
 * Never throws: a malformed or truncated hash in the database is a failed
 * verification, not a 500. Returning `false` keeps a corrupt row from turning
 * into an error that distinguishes it from a wrong password.
 */
export async function verifyPassword(storedHash: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(storedHash, plaintext, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}
