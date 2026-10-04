import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailTokenRepository } from '../src/auth/account-email/email-token.repository.js';
import { Mailer } from '../src/notifications/mail/mailer.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { OutboxMailer } from './support/outbox-mailer.js';
import { createTestApp, findCookie, httpServer, resetDatabase } from './test-app.js';

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a completely different passphrase';

describe('Account emails: confirming an address, resetting a password (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let outbox: OutboxMailer;

  const api = () => request(httpServer(app));

  /** Sending is not awaited by the request, so wait for it to land. */
  const nextEmail = async (count: number) => {
    await vi.waitFor(() => expect(outbox.sent.length).toBeGreaterThanOrEqual(count), { timeout: 2_000 });
    return outbox.sent[count - 1];
  };
  const tokenIn = (text: string) => /token=([\w-]+)/.exec(text)?.[1] ?? '';

  const register = async (email = 'driver@example.com') => {
    const response = await api()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, displayName: 'Sam' })
      .expect(201);
    const body = response.body as { accessToken: string; user: { id: string; emailVerified: boolean } };
    return { ...body, refreshCookie: findCookie(response.headers, 'carcare_refresh_token')!.value };
  };
  const me = async (token: string) =>
    (await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(200)).body as {
      emailVerified: boolean;
    };

  beforeAll(async () => {
    outbox = new OutboxMailer();
    app = await createTestApp({}, (builder) => builder.overrideProvider(Mailer).useValue(outbox));
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(app);
    outbox.sent.length = 0;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('confirming an email address', () => {
    it('emails a link at sign-up, and the link confirms the address once', async () => {
      const { accessToken, user } = await register();
      expect(user.emailVerified).toBe(false);

      const email = await nextEmail(1);
      expect(email).toMatchObject({ to: 'driver@example.com', subject: 'Confirm your email for CarCare' });
      expect(email.text).toContain('http://localhost:3000/verify-email?token=');

      const token = tokenIn(email.text);
      await api().post('/api/v1/auth/email/verify').send({ token }).expect(200, { verified: true });
      expect((await me(accessToken)).emailVerified).toBe(true);

      // Single use.
      const again = await api().post('/api/v1/auth/email/verify').send({ token }).expect(400);
      expect((again.body as { message: string }).message).toMatch(/expired or was already used/);
    });

    it('stores only a hash of the link', async () => {
      await register();
      const token = tokenIn((await nextEmail(1)).text);
      const rows = await prisma.emailToken.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tokenHash).not.toBe(token);
      expect(rows[0]?.tokenHash).toHaveLength(64);
    });

    it('refuses an expired link, and one that was never sent', async () => {
      await register();
      const token = tokenIn((await nextEmail(1)).text);
      await prisma.emailToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      await api().post('/api/v1/auth/email/verify').send({ token }).expect(400);
      await api().post('/api/v1/auth/email/verify').send({ token: 'made-up' }).expect(400);
    });

    it('refuses a link sent to an address the account no longer has', async () => {
      const { user } = await register();
      const token = tokenIn((await nextEmail(1)).text);
      await prisma.user.update({ where: { id: user.id }, data: { email: 'changed@example.com' } });
      await api().post('/api/v1/auth/email/verify').send({ token }).expect(400);
    });

    it('sends a fresh link on request, which retires the old one', async () => {
      const { accessToken } = await register();
      const first = tokenIn((await nextEmail(1)).text);

      await api().post('/api/v1/auth/email/verify/resend').expect(401);
      await api()
        .post('/api/v1/auth/email/verify/resend')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(202);
      const second = tokenIn((await nextEmail(2)).text);

      await api().post('/api/v1/auth/email/verify').send({ token: first }).expect(400);
      await api().post('/api/v1/auth/email/verify').send({ token: second }).expect(200);

      // Nothing more to send once confirmed.
      await api()
        .post('/api/v1/auth/email/verify/resend')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(202);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(outbox.sent).toHaveLength(2);
    });
  });

  it('says so when email is not set up, instead of pretending it sent', async () => {
    const { accessToken } = await register();
    outbox.enabled = false;
    try {
      const { body } = await api()
        .post('/api/v1/auth/email/verify/resend')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(503);
      expect((body as { message: string }).message).toMatch(/isn't set up/);
    } finally {
      outbox.enabled = true;
    }
  });

  describe('forgotten passwords', () => {
    it('answers the same for an address with no account, and sends nothing', async () => {
      await api().post('/api/v1/auth/password/forgot').send({ email: 'nobody@example.com' }).expect(202, {});
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(outbox.sent).toHaveLength(0);
    });

    it('resets the password once, signs out every session, and confirms the address', async () => {
      const { accessToken, refreshCookie } = await register();
      await nextEmail(1); // the confirmation, left unclicked

      await api().post('/api/v1/auth/password/forgot').send({ email: ' Driver@Example.com ' }).expect(202);
      const email = await nextEmail(2);
      expect(email.subject).toBe('Reset your CarCare password');
      const token = tokenIn(email.text);

      await api().post('/api/v1/auth/password/reset').send({ token, password: 'short' }).expect(400);
      await api().post('/api/v1/auth/password/reset').send({ token, password: NEW_PASSWORD }).expect(200);

      // The old session is gone; the new password works and the old one does not.
      await api()
        .post('/api/v1/auth/refresh')
        .set('Cookie', `carcare_refresh_token=${refreshCookie}`)
        .expect(401);
      await api()
        .post('/api/v1/auth/login')
        .send({ email: 'driver@example.com', password: PASSWORD })
        .expect(401);
      await api()
        .post('/api/v1/auth/login')
        .send({ email: 'driver@example.com', password: NEW_PASSWORD })
        .expect(200);
      expect((await me(accessToken)).emailVerified).toBe(true);

      await api().post('/api/v1/auth/password/reset').send({ token, password: NEW_PASSWORD }).expect(400);
    });

    it('does not accept a confirmation link as a reset link', async () => {
      await register();
      const token = tokenIn((await nextEmail(1)).text);
      await api().post('/api/v1/auth/password/reset').send({ token, password: NEW_PASSWORD }).expect(400);
    });

    /*
     * The parallel test below does not force the race: over a local socket the
     * requests arrive one after another, and the earlier "already used?" read
     * catches the repeats — it passed with the guard removed. This one tests
     * the guard itself: a second spend of the same row must report failure,
     * which is what stops two clicks that both read "unused" in the same instant.
     */
    it('spends a token exactly once, even after it was read as unused', async () => {
      await register();
      await nextEmail(1);
      const { id } = await prisma.emailToken.findFirstOrThrow();
      const tokens = app.get(EmailTokenRepository);
      expect(await tokens.consume(prisma, id, new Date())).toBe(true);
      expect(await tokens.consume(prisma, id, new Date())).toBe(false);
    });

    it('lets one of several simultaneous clicks through', async () => {
      await register();
      await nextEmail(1);
      await api().post('/api/v1/auth/password/forgot').send({ email: 'driver@example.com' }).expect(202);
      const token = tokenIn((await nextEmail(2)).text);

      const results = await Promise.all(
        [1, 2, 3].map(() =>
          api().post('/api/v1/auth/password/reset').send({ token, password: NEW_PASSWORD }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400]);
    });
  });
});
