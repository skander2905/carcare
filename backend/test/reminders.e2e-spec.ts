import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, httpServer, resetDatabase } from './test-app.js';

const PASSWORD = 'correct horse battery staple';
const MISSING_ID = '0192f8c1-2b3d-7e4f-8a9b-1c2d3e4f5a6b';

interface ReminderBody {
  id: string;
  title: string;
  type: string;
  dueDate: string | null;
  dueOdometerKm: number | null;
  repeatEveryMonths: number | null;
  status: string;
  completedAt: string | null;
  due: {
    status: string;
    km: { dueAtKm: number; remainingKm: number; status: string } | null;
    time: { dueDate: string; remainingDays: number; status: string } | null;
  } | null;
}

/** YYYY-MM-DD, n days from today in Tunis (UTC+1, no DST) — the default owner time zone. */
const inDays = (n: number) => {
  const date = new Date(Date.now() + 3_600_000);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
};

describe('Reminders (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let vehicleId: string;

  const register = async (email: string) => {
    const { body } = await request(httpServer(app))
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, displayName: email.split('@')[0] })
      .expect(201);
    return (body as { accessToken: string }).accessToken;
  };

  const as = (bearer: string) => ({
    post: (path: string) =>
      request(httpServer(app)).post(`/api/v1${path}`).set('Authorization', `Bearer ${bearer}`),
    get: (path: string) =>
      request(httpServer(app)).get(`/api/v1${path}`).set('Authorization', `Bearer ${bearer}`),
    patch: (path: string) =>
      request(httpServer(app)).patch(`/api/v1${path}`).set('Authorization', `Bearer ${bearer}`),
    delete: (path: string) =>
      request(httpServer(app)).delete(`/api/v1${path}`).set('Authorization', `Bearer ${bearer}`),
  });
  const me = () => as(token);
  const create = (body: Record<string, unknown>) => me().post(`/vehicles/${vehicleId}/reminders`).send(body);

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    token = await register('driver@example.com');
    const { body } = await me()
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
    vehicleId = (body as { id: string }).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('creating', () => {
    it('derives the status from the date, with the default 30-day window', async () => {
      const { body } = await create({
        type: 'INSURANCE',
        title: 'Insurance renewal',
        dueDate: inDays(12),
      }).expect(201);
      const reminder = body as ReminderBody;
      expect(reminder).toMatchObject({ status: 'PENDING', dueDate: inDays(12), completedAt: null });
      expect(reminder.due).toMatchObject({ status: 'DUE_SOON', km: null, time: { remainingDays: 12 } });
    });

    it('takes a mileage, and whichever comes first', async () => {
      const { body } = await create({
        type: 'WARRANTY',
        title: 'Warranty ends',
        dueDate: inDays(400),
        dueOdometerKm: 120_400,
      }).expect(201);
      expect((body as ReminderBody).due).toMatchObject({
        status: 'DUE_SOON',
        km: { dueAtKm: 120_400, remainingKm: 400, status: 'DUE_SOON' },
        time: { status: 'UPCOMING' },
      });
    });

    it('refuses a reminder that could never fall due, saying why', async () => {
      const { body } = await create({ type: 'OTHER', title: 'Someday' }).expect(400);
      expect((body as { message: string }).message).toMatch(/dueDate, dueOdometerKm or both/);
    });

    it('refuses repeating without a date to count from', async () => {
      await create({ type: 'LOAN', title: 'Loan', dueOdometerKm: 130_000, repeatEveryMonths: 1 }).expect(400);
    });

    it('refuses a date that does not exist, rather than rolling it over', async () => {
      await create({ type: 'OTHER', title: 'Leap', dueDate: '2027-02-29' }).expect(400);
      await create({ type: 'OTHER', title: 'Instant', dueDate: '2027-03-01T10:00:00Z' }).expect(400);
    });
  });

  describe('listing', () => {
    it('puts pending first, most urgent first, and completed last', async () => {
      const later = (await create({ type: 'ROAD_TAX', title: 'Vignette', dueDate: inDays(200) }))
        .body as ReminderBody;
      const overdue = (await create({ type: 'INSURANCE', title: 'Insurance', dueDate: inDays(-40) }))
        .body as ReminderBody;
      const done = (await create({ type: 'OTHER', title: 'Done', dueDate: inDays(1) })).body as ReminderBody;
      await me().post(`/reminders/${done.id}/complete`).expect(200);

      const { body } = await me().get(`/vehicles/${vehicleId}/reminders`).expect(200);
      expect((body as ReminderBody[]).map((r) => r.id)).toEqual([overdue.id, later.id, done.id]);
      expect((body as ReminderBody[])[0]?.due?.status).toBe('OVERDUE');
      expect((body as ReminderBody[])[2]?.due).toBeNull();
    });

    it('filters by status and by due date', async () => {
      await create({ type: 'ROAD_TAX', title: 'Far', dueDate: inDays(200) });
      await create({ type: 'INSURANCE', title: 'Near', dueDate: inDays(5) });

      const near = await me()
        .get(`/vehicles/${vehicleId}/reminders?dueBefore=${inDays(30)}`)
        .expect(200);
      expect((near.body as ReminderBody[]).map((r) => r.title)).toEqual(['Near']);

      const completed = await me().get(`/vehicles/${vehicleId}/reminders?status=COMPLETED`).expect(200);
      expect(completed.body).toEqual([]);
    });
  });

  describe('completing', () => {
    it('creates the next occurrence from the due date, not from today', async () => {
      const due = inDays(-3);
      const { body } = await create({
        type: 'INSURANCE',
        title: 'Insurance renewal',
        dueDate: due,
        repeatEveryMonths: 12,
        notifyBeforeDays: 45,
      });
      const id = (body as ReminderBody).id;

      const done = await me().post(`/reminders/${id}/complete`).expect(200);
      const { completed, next } = done.body as { completed: ReminderBody; next: ReminderBody };
      expect(completed).toMatchObject({ id, status: 'COMPLETED', due: null });
      expect(completed.completedAt).not.toBeNull();

      const [year, month, day] = due.split('-');
      expect(next).toMatchObject({
        status: 'PENDING',
        title: 'Insurance renewal',
        dueDate: `${Number(year) + 1}-${month}-${day}`,
        repeatEveryMonths: 12,
      });
      expect(next.due?.status).toBe('UPCOMING');
    });

    it('refuses to complete twice, which would create two successors', async () => {
      const { body } = await create({
        type: 'ROAD_TAX',
        title: 'Vignette',
        dueDate: inDays(1),
        repeatEveryMonths: 12,
      });
      const id = (body as ReminderBody).id;
      await me().post(`/reminders/${id}/complete`).expect(200);
      await me().post(`/reminders/${id}/complete`).expect(409);

      const { body: all } = await me().get(`/vehicles/${vehicleId}/reminders`).expect(200);
      expect(all).toHaveLength(2);
    });

    it('completes a one-off with no successor', async () => {
      const { body } = await create({ type: 'WARRANTY', title: 'Warranty', dueOdometerKm: 125_000 });
      const done = await me()
        .post(`/reminders/${(body as ReminderBody).id}/complete`)
        .expect(200);
      expect((done.body as { next: unknown }).next).toBeNull();
    });
  });

  describe('editing and deleting', () => {
    it('moves the due point and re-derives the status', async () => {
      const { body } = await create({ type: 'INSURANCE', title: 'Insurance', dueDate: inDays(200) });
      const id = (body as ReminderBody).id;
      const { body: edited } = await me()
        .patch(`/reminders/${id}`)
        .send({ dueDate: inDays(3) })
        .expect(200);
      expect((edited as ReminderBody).due?.status).toBe('DUE_SOON');
    });

    it('refuses to remove the last due point', async () => {
      const { body } = await create({ type: 'INSURANCE', title: 'Insurance', dueDate: inDays(200) });
      await me()
        .patch(`/reminders/${(body as ReminderBody).id}`)
        .send({ dueDate: null })
        .expect(400);
    });

    it('deletes', async () => {
      const { body } = await create({ type: 'INSURANCE', title: 'Insurance', dueDate: inDays(200) });
      const id = (body as ReminderBody).id;
      await me().delete(`/reminders/${id}`).expect(204);
      await me().get(`/reminders/${id}`).expect(404);
    });
  });

  describe('access', () => {
    it("answers 404 for someone else's reminder, and for one that never existed", async () => {
      const { body } = await create({ type: 'INSURANCE', title: 'Insurance', dueDate: inDays(10) });
      const id = (body as ReminderBody).id;
      const stranger = await register('stranger@example.com');

      await as(stranger).get(`/reminders/${id}`).expect(404);
      await as(stranger).patch(`/reminders/${id}`).send({ title: 'Mine now' }).expect(404);
      await as(stranger).post(`/reminders/${id}/complete`).expect(404);
      await as(stranger).get(`/vehicles/${vehicleId}/reminders`).expect(404);
      await me().get(`/reminders/${MISSING_ID}`).expect(404);
      await me().get('/reminders/not-a-uuid').expect(400);
    });
  });
});
