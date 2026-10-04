import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DigestService } from '../src/notifications/digest.service.js';
import { Mailer } from '../src/notifications/mail/mailer.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { DueSweepService } from '../src/reminders/due-sweep.service.js';
import { OutboxMailer } from './support/outbox-mailer.js';
import { createTestApp, httpServer, resetDatabase } from './test-app.js';

const PASSWORD = 'correct horse battery staple';
const DAY = 86_400_000;

interface NotificationBody {
  id: string;
  type: string;
  title: string;
  body: string;
  path: string;
  data: Record<string, unknown>;
  readAt: string | null;
}

/** YYYY-MM-DD, n days from today in Tunis (UTC+1, no DST) — the default owner time zone. */
const inDays = (n: number) => {
  const date = new Date(Date.now() + 3_600_000);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
};

/**
 * The sweep and the digest are what the worker's jobs call. They are driven
 * directly here, at chosen moments, so the suite tests what is decided —
 * without a queue, and without waiting an hour.
 */
describe('Reminder sweep and notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sweep: DueSweepService;
  let digest: DigestService;
  let notifications: NotificationsService;
  let outbox: OutboxMailer;
  let token: string;
  let userId: string;
  let vehicleId: string;
  let scheduleId: string;

  const register = async (email: string) => {
    const { body } = await request(httpServer(app))
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, displayName: email.split('@')[0] })
      .expect(201);
    return body as { accessToken: string; user: { id: string } };
  };

  const as = (bearer: string) => ({
    post: (path: string) =>
      request(httpServer(app)).post(`/api/v1${path}`).set('Authorization', `Bearer ${bearer}`),
    get: (path: string) =>
      request(httpServer(app)).get(`/api/v1${path}`).set('Authorization', `Bearer ${bearer}`),
    patch: (path: string) =>
      request(httpServer(app)).patch(`/api/v1${path}`).set('Authorization', `Bearer ${bearer}`),
  });
  const me = () => as(token);

  const inbox = async () =>
    ((await me().get('/notifications').expect(200)).body as { data: NotificationBody[] }).data;
  const rows = () => prisma.notification.findMany({ orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    outbox = new OutboxMailer();
    app = await createTestApp({}, (builder) => builder.overrideProvider(Mailer).useValue(outbox));
    prisma = app.get(PrismaService);
    sweep = app.get(DueSweepService);
    digest = app.get(DigestService);
    notifications = app.get(NotificationsService);
  });

  beforeEach(async () => {
    await resetDatabase(app);
    outbox.sent.length = 0;
    outbox.failNext = false;

    const user = await register('driver@example.com');
    token = user.accessToken;
    userId = user.user.id;
    // Confirmed, as through the emailed link: nothing is emailed to an unconfirmed address.
    await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    // Drop the confirmation email sign-up sent, so these tests count only digests.
    await new Promise((resolve) => setTimeout(resolve, 50));
    outbox.sent.length = 0;

    const vehicle = await me()
      .post('/vehicles')
      .send({
        make: 'Peugeot',
        model: '208',
        year: 2020,
        licensePlate: '200 TUN 2020',
        fuelType: 'PETROL',
        initialOdometerKm: 120_000,
      })
      .expect(201);
    vehicleId = (vehicle.body as { id: string }).id;

    // Oil every 10,000 km, last done at 110,500: due at 120,500, so 500 km away — due soon.
    const schedule = await me()
      .post(`/vehicles/${vehicleId}/maintenance-schedules`)
      .send({
        type: 'OIL_CHANGE',
        name: 'Oil and filter',
        intervalKm: 10_000,
        lastServiceOdometerKm: 110_500,
      })
      .expect(201);
    scheduleId = (schedule.body as { id: string }).id;

    // Insurance renews in 10 days: due soon.
    await me()
      .post(`/vehicles/${vehicleId}/reminders`)
      .send({ type: 'INSURANCE', title: 'Insurance renewal', dueDate: inDays(10) })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('the sweep', () => {
    it('tells the owner about everything due, in words', async () => {
      const result = await sweep.run();
      expect(result).toMatchObject({ vehicles: 1, alerts: 2, created: 2, failed: 0 });

      const items = await inbox();
      expect(items.map((n) => n.title).sort()).toEqual([
        'Insurance renewal is due soon · Peugeot 208',
        'Oil and filter is due soon · Peugeot 208',
      ]);
      const oil = items.find((n) => n.type === 'MAINTENANCE_DUE');
      expect(oil).toMatchObject({
        body: 'Due in 500 km.',
        path: `/vehicles/${vehicleId}/maintenance`,
        data: { status: 'DUE_SOON', scheduleId, vehicleId },
        readAt: null,
      });
      expect(items.find((n) => n.type === 'REMINDER_DUE')?.path).toBe(`/vehicles/${vehicleId}/reminders`);
    });

    it('says nothing twice: running again, or twice at once, adds nothing', async () => {
      await sweep.run();
      // `failed` too: a duplicate that raised would be swallowed per vehicle and still create nothing.
      expect(await sweep.run()).toMatchObject({ created: 0, failed: 0 });

      // Two workers overlapping: the unique (userId, dedupeKey) makes one row of each.
      const results = await Promise.all([sweep.run(), sweep.run(), sweep.run()]);
      expect(results.reduce((sum, r) => sum + r.created, 0)).toBe(0);
      expect(results.every((r) => r.failed === 0)).toBe(true);
      expect(await rows()).toHaveLength(2);
    });

    it('announces each step as it is reached', async () => {
      await sweep.run();

      // Five days past the renewal: due. The oil, measured in km, has not moved.
      const due = await sweep.run(new Date(Date.now() + 15 * DAY));
      expect(due.created).toBe(1);

      // A further month on, past the 30-day window: overdue.
      const overdue = await sweep.run(new Date(Date.now() + 45 * DAY));
      expect(overdue.created).toBe(1);

      const titles = (await inbox()).map((n) => n.title);
      expect(titles).toContain('Insurance renewal is due · Peugeot 208');
      expect(titles).toContain('Insurance renewal is overdue · Peugeot 208');
    });

    it('starts a new cycle once the service is logged', async () => {
      await sweep.run();

      await me()
        .post(`/vehicles/${vehicleId}/maintenance`)
        .send({ type: 'OIL_CHANGE', odometerKm: 120_100, totalCost: '150', scheduleId })
        .expect(201);
      // Next due at 130,100 — nothing to say yet.
      expect((await sweep.run()).created).toBe(0);

      await me().post(`/vehicles/${vehicleId}/odometer`).send({ odometerKm: 129_500 }).expect(201);
      expect((await sweep.run()).created).toBe(1);

      const oil = (await rows()).filter((n) => n.type === 'MAINTENANCE_DUE');
      expect(oil.map((n) => n.dedupeKey)).toEqual([
        `maintenance:${scheduleId}:DUE_SOON:120500km/-`,
        `maintenance:${scheduleId}:DUE_SOON:130100km/-`,
      ]);
    });

    it('stays quiet about paused schedules, completed reminders and archived cars', async () => {
      await me().patch(`/maintenance-schedules/${scheduleId}`).send({ isActive: false }).expect(200);
      const [reminder] = (await me().get(`/vehicles/${vehicleId}/reminders`)).body as { id: string }[];
      await me().post(`/reminders/${reminder?.id}/complete`).expect(200);
      expect((await sweep.run()).created).toBe(0);

      await me().patch(`/maintenance-schedules/${scheduleId}`).send({ isActive: true }).expect(200);
      await prisma.vehicle.update({ where: { id: vehicleId }, data: { archivedAt: new Date() } });
      expect(await sweep.run()).toMatchObject({ vehicles: 0, created: 0 });
    });

    it('tells only people who can see the car', async () => {
      const stranger = await register('stranger@example.com');
      await sweep.run();
      const theirs = await as(stranger.accessToken).get('/notifications').expect(200);
      expect((theirs.body as { data: unknown[] }).data).toEqual([]);
    });
  });

  describe('the inbox', () => {
    beforeEach(async () => {
      await sweep.run();
    });

    it('counts unread, marks one read, then all', async () => {
      expect((await me().get('/notifications/unread-count').expect(200)).body).toEqual({ count: 2 });

      const [first] = await inbox();
      const { body } = await me().patch(`/notifications/${first?.id}/read`).expect(200);
      const readAt = (body as NotificationBody).readAt;
      expect(readAt).not.toBeNull();

      // Reading it again keeps the first time.
      const again = await me().patch(`/notifications/${first?.id}/read`).expect(200);
      expect((again.body as NotificationBody).readAt).toBe(readAt);

      const unread = await me().get('/notifications?unreadOnly=true').expect(200);
      expect((unread.body as { data: unknown[] }).data).toHaveLength(1);

      expect((await me().post('/notifications/read-all').expect(200)).body).toEqual({ updated: 1 });
      expect((await me().get('/notifications/unread-count').expect(200)).body).toEqual({ count: 0 });
    });

    it("answers 404 for someone else's notification", async () => {
      const [first] = await inbox();
      const stranger = await register('stranger@example.com');
      await as(stranger.accessToken).patch(`/notifications/${first?.id}/read`).expect(404);
      await me().patch('/notifications/not-a-uuid/read').expect(400);
    });
  });

  describe('the email digest', () => {
    it('sends everything owed as one email, once', async () => {
      await sweep.run();
      expect(await notifications.usersAwaitingEmail()).toEqual([{ id: userId, timezone: 'Africa/Tunis' }]);

      expect(await digest.send(userId)).toBe('sent');
      expect(outbox.sent).toHaveLength(1);
      const [email] = outbox.sent;
      expect(email).toMatchObject({ to: 'driver@example.com', subject: '2 car reminders need attention' });
      expect(email?.text).toContain('Oil and filter is due soon · Peugeot 208');
      expect(email?.text).toContain(`http://localhost:3000/vehicles/${vehicleId}/maintenance`);

      expect((await rows()).every((n) => n.emailStatus === 'SENT' && n.emailedAt !== null)).toBe(true);
      expect(await digest.send(userId)).toBe('nothing-to-send');
      expect(await notifications.usersAwaitingEmail()).toEqual([]);
      expect(outbox.sent).toHaveLength(1);
    });

    it('sends nothing to someone who turned email off', async () => {
      const { body } = await me().patch('/users/me').send({ emailNotifications: false }).expect(200);
      expect((body as { emailNotifications: boolean }).emailNotifications).toBe(false);

      await sweep.run();
      expect((await rows()).map((n) => n.emailStatus)).toEqual(['SKIPPED', 'SKIPPED']);
      expect(await digest.send(userId)).toBe('nothing-to-send');
      expect(outbox.sent).toHaveLength(0);
    });

    it('emails nothing to an address that was never confirmed', async () => {
      await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: null } });
      await sweep.run();
      expect((await rows()).map((n) => n.emailStatus)).toEqual(['SKIPPED', 'SKIPPED']);
      expect(await digest.send(userId)).toBe('nothing-to-send');
      expect(outbox.sent).toHaveLength(0);
    });

    it('carries a stop link that works without signing in, and only for that person', async () => {
      await sweep.run();
      await digest.send(userId);
      const [email] = outbox.sent;

      // Gmail's own button posts to the header's URL.
      const header = email?.headers?.['List-Unsubscribe'] ?? '';
      expect(email?.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      const url = new URL(/<(.+)>/.exec(header)?.[1] ?? 'http://x');
      expect(url.pathname).toBe('/api/v1/notifications/unsubscribe');
      const signed = url.searchParams.get('token') ?? '';
      expect(email?.text).toContain(`http://localhost:3000/unsubscribe?token=${encodeURIComponent(signed)}`);

      // Tampered: refused, and nothing changes.
      await request(httpServer(app))
        .post(`/api/v1/notifications/unsubscribe?token=${encodeURIComponent(signed.slice(0, -2) + 'xx')}`)
        .expect(400);
      // A GET (a mail scanner opening the link) changes nothing either.
      await request(httpServer(app)).get(
        `/api/v1/notifications/unsubscribe?token=${encodeURIComponent(signed)}`,
      );
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).emailNotifications).toBe(true);

      await request(httpServer(app))
        .post(`/api/v1/notifications/unsubscribe?token=${encodeURIComponent(signed)}`)
        .type('form')
        .send('List-Unsubscribe=One-Click')
        .expect(200, { unsubscribed: true });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).emailNotifications).toBe(false);
    });

    it('skips what was already read in the app before the email went', async () => {
      await sweep.run();
      const [first] = await inbox();
      await me().patch(`/notifications/${first?.id}/read`).expect(200);

      await digest.send(userId);
      expect(outbox.sent[0]?.subject).not.toBe(first?.title);
      expect(outbox.sent[0]?.text).not.toContain(first?.title);
      expect((await rows()).map((n) => n.emailStatus).sort()).toEqual(['SENT', 'SKIPPED']);
    });

    it('keeps the rows owed when sending fails, so the retry sends them', async () => {
      await sweep.run();
      outbox.failNext = true;
      await expect(digest.send(userId)).rejects.toThrow('SMTP server unreachable');
      expect((await rows()).every((n) => n.emailStatus === 'PENDING')).toBe(true);

      expect(await digest.send(userId)).toBe('sent');
      expect(outbox.sent).toHaveLength(1);
    });

    it('sends once when two digests for the same person overlap', async () => {
      await sweep.run();
      const outcomes = await Promise.all([digest.send(userId), digest.send(userId), digest.send(userId)]);
      expect(outcomes.filter((o) => o === 'sent')).toHaveLength(1);
      expect(outbox.sent).toHaveLength(1);
    });
  });
});
