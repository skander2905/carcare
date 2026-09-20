import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, findCookie, httpServer, resetDatabase } from './test-app.js';

const COOKIE = 'carcare_refresh_token';
const PASSWORD = 'correct horse battery staple';

const credentials = (email: string) => ({ email, password: PASSWORD, displayName: 'Sam Ben Ali' });

describe('Authentication (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Zero grace: every reuse of a rotated token is judged a replay, which is
    // what makes replay detection testable without a ten-second wait.
    app = await createTestApp({ reuseGraceMs: 0 });
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  const register = (email: string) =>
    request(httpServer(app)).post('/api/v1/auth/register').send(credentials(email));

  describe('POST /auth/register', () => {
    it('creates an account and starts a session', async () => {
      const response = await register('sam@example.com').expect(201);

      expect(response.body.user).toMatchObject({
        email: 'sam@example.com',
        displayName: 'Sam Ben Ali',
        role: 'USER',
        currency: 'TND',
      });
      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.expiresIn).toBe(900);
    });

    it('never returns the password or its hash', async () => {
      const response = await register('sam@example.com').expect(201);

      // Asserted against the whole serialised body, so a field added to the
      // mapper later cannot smuggle one through.
      expect(JSON.stringify(response.body)).not.toContain(PASSWORD);
      expect(response.body.user.passwordHash).toBeUndefined();
    });

    it('sets the refresh token as an httpOnly cookie scoped to the auth path', async () => {
      const response = await register('sam@example.com').expect(201);
      const cookie = findCookie(response.headers, COOKIE);

      expect(cookie).toBeDefined();
      // The three properties the whole design depends on: unreadable by script,
      // not sent cross-site, and not attached to every other API call.
      expect(cookie!.attributes).toContain('HttpOnly');
      expect(cookie!.attributes).toContain('SameSite=Lax');
      expect(cookie!.attributes).toContain('Path=/api/v1/auth');
    });

    it('keeps the refresh token out of the response body', async () => {
      const response = await register('sam@example.com').expect(201);
      const cookie = findCookie(response.headers, COOKIE)!;

      expect(JSON.stringify(response.body)).not.toContain(decodeURIComponent(cookie.value));
    });

    it('rejects a second account on the same address', async () => {
      await register('sam@example.com').expect(201);

      const response = await register('sam@example.com').expect(409);
      expect(response.body).toMatchObject({ statusCode: 409, error: 'Conflict' });
    });

    it('treats a differently-cased address as the same account', async () => {
      await register('sam@example.com').expect(201);
      await register('SAM@Example.com').expect(409);
    });

    it('rejects a password below the minimum, listing the reason', async () => {
      const response = await request(httpServer(app))
        .post('/api/v1/auth/register')
        .send({ email: 'sam@example.com', password: 'short', displayName: 'Sam' })
        .expect(400);

      const details = response.body.details as string[];
      expect(details.join(' ')).toMatch(/password must be between 12 and 128/);
    });

    it('refuses an unknown property rather than silently dropping it', async () => {
      // Mass assignment must fail loudly: this is the request that would try to
      // grant itself ADMIN.
      await request(httpServer(app))
        .post('/api/v1/auth/register')
        .send({ ...credentials('sam@example.com'), role: 'ADMIN' })
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await register('sam@example.com').expect(201);
    });

    it('returns a session for correct credentials', async () => {
      const response = await request(httpServer(app))
        .post('/api/v1/auth/login')
        .send({ email: 'sam@example.com', password: PASSWORD })
        .expect(200);

      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(findCookie(response.headers, COOKIE)).toBeDefined();
    });

    it('accepts the address in any casing', async () => {
      await request(httpServer(app))
        .post('/api/v1/auth/login')
        .send({ email: '  SAM@EXAMPLE.COM ', password: PASSWORD })
        .expect(200);
    });

    it('answers a wrong password and an unknown address identically', async () => {
      const wrongPassword = await request(httpServer(app))
        .post('/api/v1/auth/login')
        .send({ email: 'sam@example.com', password: 'wrong password here' })
        .expect(401);

      const unknownEmail = await request(httpServer(app))
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: PASSWORD })
        .expect(401);

      // Any difference here turns the login form into a registered-address oracle.
      expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
      expect(wrongPassword.body.error).toBe(unknownEmail.body.error);
    });

    it('starts a session unrelated to the previous one', async () => {
      const first = await request(httpServer(app))
        .post('/api/v1/auth/login')
        .send({ email: 'sam@example.com', password: PASSWORD })
        .expect(200);

      const second = await request(httpServer(app))
        .post('/api/v1/auth/login')
        .send({ email: 'sam@example.com', password: PASSWORD })
        .expect(200);

      // Separate families, so logging out on one device leaves the other alone.
      expect(findCookie(first.headers, COOKIE)!.value).not.toBe(findCookie(second.headers, COOKIE)!.value);
    });
  });

  describe('GET /auth/me', () => {
    it('requires an access token', async () => {
      const response = await request(httpServer(app)).get('/api/v1/auth/me').expect(401);

      expect(response.body).toMatchObject({ statusCode: 401, error: 'Unauthorized' });
    });

    it('rejects a malformed or forged token', async () => {
      await request(httpServer(app))
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer not.a.real.token')
        .expect(401);
    });

    it('returns the authenticated user', async () => {
      const { body } = await register('sam@example.com').expect(201);

      const response = await request(httpServer(app))
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({ id: body.user.id, email: 'sam@example.com' });
    });

    it('does not accept the refresh cookie in place of an access token', async () => {
      const registered = await register('sam@example.com').expect(201);
      const cookie = findCookie(registered.headers, COOKIE)!;

      // The cookie authorises rotation and nothing else.
      await request(httpServer(app))
        .get('/api/v1/auth/me')
        .set('Cookie', `${COOKIE}=${cookie.value}`)
        .expect(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the cookie and returns a new access token', async () => {
      const registered = await register('sam@example.com').expect(201);
      const original = findCookie(registered.headers, COOKIE)!.value;

      const response = await request(httpServer(app))
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${COOKIE}=${original}`)
        .expect(200);

      expect(response.body.accessToken).toEqual(expect.any(String));
      // No user object: the refresh response is deliberately minimal.
      expect(response.body.user).toBeUndefined();
      expect(findCookie(response.headers, COOKIE)!.value).not.toBe(original);
    });

    it('issues a token that itself works', async () => {
      const registered = await register('sam@example.com').expect(201);

      const first = await request(httpServer(app))
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${COOKIE}=${findCookie(registered.headers, COOKIE)!.value}`)
        .expect(200);

      // Proves the client receives the plaintext token and not its stored hash:
      // a hash would not survive a second round trip.
      await request(httpServer(app))
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${COOKIE}=${findCookie(first.headers, COOKIE)!.value}`)
        .expect(200);
    });

    it('rejects a request with no cookie', async () => {
      await request(httpServer(app)).post('/api/v1/auth/refresh').expect(401);
    });

    it('rejects a token that was never issued', async () => {
      await request(httpServer(app))
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${COOKIE}=obviously-not-a-real-token`)
        .expect(401);
    });

    describe('replay detection', () => {
      it('kills the whole family when a spent token is presented again', async () => {
        const registered = await register('sam@example.com').expect(201);
        const stolen = findCookie(registered.headers, COOKIE)!.value;

        const rotated = await request(httpServer(app))
          .post('/api/v1/auth/refresh')
          .set('Cookie', `${COOKIE}=${stolen}`)
          .expect(200);

        const legitimate = findCookie(rotated.headers, COOKIE)!.value;

        // The thief replays the token the victim already spent.
        await request(httpServer(app))
          .post('/api/v1/auth/refresh')
          .set('Cookie', `${COOKIE}=${stolen}`)
          .expect(401);

        // ...which also ends the victim's session. Both parties must
        // re-authenticate, because there is no way to tell them apart.
        await request(httpServer(app))
          .post('/api/v1/auth/refresh')
          .set('Cookie', `${COOKIE}=${legitimate}`)
          .expect(401);
      });

      it('clears the cookie when rotation fails for good', async () => {
        const response = await request(httpServer(app))
          .post('/api/v1/auth/refresh')
          .set('Cookie', `${COOKIE}=never-issued`)
          .expect(401);

        // Expires immediately, so the browser stops presenting a dead token.
        const cleared = findCookie(response.headers, COOKIE);
        expect(cleared?.attributes).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/);
      });

      it('leaves other sessions on the same account untouched', async () => {
        await register('sam@example.com').expect(201);

        const phone = await request(httpServer(app))
          .post('/api/v1/auth/login')
          .send({ email: 'sam@example.com', password: PASSWORD })
          .expect(200);
        const laptop = await request(httpServer(app))
          .post('/api/v1/auth/login')
          .send({ email: 'sam@example.com', password: PASSWORD })
          .expect(200);

        const phoneToken = findCookie(phone.headers, COOKIE)!.value;

        await request(httpServer(app))
          .post('/api/v1/auth/refresh')
          .set('Cookie', `${COOKIE}=${phoneToken}`)
          .expect(200);
        await request(httpServer(app))
          .post('/api/v1/auth/refresh')
          .set('Cookie', `${COOKIE}=${phoneToken}`)
          .expect(401);

        // A compromise on one device must not sign the user out everywhere:
        // each login is its own family.
        await request(httpServer(app))
          .post('/api/v1/auth/refresh')
          .set('Cookie', `${COOKIE}=${findCookie(laptop.headers, COOKIE)!.value}`)
          .expect(200);
      });
    });
  });

  describe('POST /auth/logout', () => {
    it('ends the session and clears the cookie', async () => {
      const registered = await register('sam@example.com').expect(201);
      const token = findCookie(registered.headers, COOKIE)!.value;

      const response = await request(httpServer(app))
        .post('/api/v1/auth/logout')
        .set('Cookie', `${COOKIE}=${token}`)
        .expect(204);

      expect(findCookie(response.headers, COOKIE)?.attributes).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/);

      await request(httpServer(app))
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${COOKIE}=${token}`)
        .expect(401);
    });

    it('succeeds without a cookie', async () => {
      // Logging out is not something a user should be able to fail at.
      await request(httpServer(app)).post('/api/v1/auth/logout').expect(204);
    });

    it('succeeds for an unknown token', async () => {
      await request(httpServer(app))
        .post('/api/v1/auth/logout')
        .set('Cookie', `${COOKIE}=never-issued`)
        .expect(204);
    });
  });

  describe('PATCH /users/me', () => {
    let accessToken: string;

    beforeEach(async () => {
      const { body } = await register('sam@example.com').expect(201);
      accessToken = body.accessToken;
    });

    it('updates the display name and preferences', async () => {
      const response = await request(httpServer(app))
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ displayName: 'Sam B.', currency: 'EUR' })
        .expect(200);

      expect(response.body).toMatchObject({ displayName: 'Sam B.', currency: 'EUR' });
    });

    it('refuses to change the role', async () => {
      // Not "ignores": whitelist + forbidNonWhitelisted means privilege
      // escalation is a 400, not a silent no-op the caller might retry.
      await request(httpServer(app))
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ role: 'ADMIN' })
        .expect(400);
    });

    it('refuses to change the email address', async () => {
      await request(httpServer(app))
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ email: 'someone.else@example.com' })
        .expect(400);
    });

    it('rejects an unsupported currency', async () => {
      await request(httpServer(app))
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currency: 'XYZ' })
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(httpServer(app)).patch('/api/v1/users/me').send({ displayName: 'Nope' }).expect(401);
    });
  });
});
