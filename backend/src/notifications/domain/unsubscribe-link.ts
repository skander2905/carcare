import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The "stop these emails" link: works without signing in, and cannot be forged.
 *
 * It names the user and carries an HMAC of that name, so changing the id breaks
 * the signature. It never expires — an unsubscribe link from last year must
 * still work, as mail rules expect — and it can only ever turn email off.
 */

const PURPOSE = 'carcare:unsubscribe:v1';

export function signUnsubscribe(userId: string, key: string): string {
  return `${Buffer.from(userId).toString('base64url')}.${mac(userId, key)}`;
}

/** The user it was made for, or null if it was tampered with or is not one. */
export function verifyUnsubscribe(token: string, key: string): string | null {
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra !== undefined) return null;
  const userId = Buffer.from(encoded, 'base64url').toString('utf8');
  const expected = Buffer.from(mac(userId, key));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? userId : null;
}

function mac(userId: string, key: string): string {
  return createHmac('sha256', key).update(`${PURPOSE}:${userId}`).digest('base64url');
}
