import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, httpServer, resetDatabase } from './test-app.js';

const PASSWORD = 'correct horse battery staple';
const MISSING_ID = '0192f8c1-2b3d-7e4f-8a9b-1c2d3e4f5a6b';

interface ExpenseBody {
  id: string;
  amount: string;
  category: string;
  vendor: string | null;
  description: string | null;
  odometerKm: number | null;
  incurredAt: string;
  sourceType: string;
  createdById: string | null;
}

interface ReadingBody {
  odometerKm: number;
  source: string;
  sourceId: string | null;
}

describe('Expenses (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let userId: string;
  let vehicleId: string;

  const day = (n: number) => new Date(Date.UTC(2026, 0, n, 12)).toISOString();

  const register = async (email: string) => {
    const { body } = await request(httpServer(app))
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, displayName: email.split('@')[0] })
      .expect(201);

    return body as { accessToken: string; user: { id: string } };
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(app);

    const driver = await register('driver@example.com');
    token = driver.accessToken;
    userId = driver.user.id;

    // Bought on 1 January at 100,000 km, so every day(n) below is after the
    // seeded reading and the timeline has a known first point.
    const vehicle = await request(httpServer(app))
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        make: 'Peugeot',
        model: '208',
        year: 2020,
        licensePlate: '200 TUN 2020',
        fuelType: 'PETROL',
        initialOdometerKm: 100_000,
        purchaseDate: new Date(Date.UTC(2026, 0, 1)).toISOString(),
      })
      .expect(201);
    vehicleId = vehicle.body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

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

  const create = (body: Record<string, unknown>) => me().post(`/vehicles/${vehicleId}/expenses`).send(body);

  const createOk = async (body: Record<string, unknown>): Promise<ExpenseBody> =>
    (await create({ category: 'OTHER', amount: '10', ...body }).expect(201)).body as ExpenseBody;

  const list = async (query = ''): Promise<{ data: ExpenseBody[]; meta: Record<string, unknown> }> =>
    (await me().get(`/vehicles/${vehicleId}/expenses${query}`).expect(200)).body as {
      data: ExpenseBody[];
      meta: Record<string, unknown>;
    };

  const readings = async (): Promise<ReadingBody[]> =>
    ((await me().get(`/vehicles/${vehicleId}/odometer`).expect(200)).body as { data: ReadingBody[] }).data;

  const currentOdometer = async (): Promise<number> =>
    ((await me().get(`/vehicles/${vehicleId}`).expect(200)).body as { currentOdometerKm: number })
      .currentOdometerKm;

  describe('creating', () => {
    it('records an expense with a fixed-width amount and the caller as author', async () => {
      const { body } = await create({ category: 'TOLL', amount: '4.5', incurredAt: day(3) }).expect(201);

      expect(body).toMatchObject({
        vehicleId,
        category: 'TOLL',
        amount: '4.500',
        incurredAt: day(3),
        odometerKm: null,
        sourceType: 'MANUAL',
        createdById: userId,
      });
    });

    it('keeps every millime', async () => {
      const expense = await createOk({ amount: '999999999.999' });
      expect(expense.amount).toBe('999999999.999');
    });

    it('rejects a zero amount with a 400 that names the field', async () => {
      const { body } = await create({ category: 'TOLL', amount: '0.000' }).expect(400);
      expect(JSON.stringify(body.details)).toContain('amount');
    });

    it('rejects a numeric amount — floats lose millimes', async () => {
      await create({ category: 'TOLL', amount: 4.5 }).expect(400);
    });

    it('refuses to let the client choose the source', async () => {
      await create({ category: 'FUEL', amount: '50', sourceType: 'FUEL' }).expect(400);
    });

    it('writes a timeline reading when the expense carries mileage', async () => {
      const expense = await createOk({ odometerKm: 101_500, incurredAt: day(5) });

      expect(await readings()).toContainEqual(
        expect.objectContaining({ odometerKm: 101_500, source: 'EXPENSE', sourceId: expense.id }),
      );
      expect(await currentOdometer()).toBe(101_500);
    });

    /**
     * The whole point of doing both in one transaction: a mileage that does
     * not fit the timeline must not leave the expense behind without it.
     */
    it('refuses the expense whole when its mileage contradicts the timeline', async () => {
      const { body } = await create({
        category: 'PARKING',
        amount: '3',
        odometerKm: 90_000,
        incurredAt: day(5),
      }).expect(400);

      expect(body.message).toContain('previous reading of 100,000 km');
      expect((await list()).meta.total).toBe(0);
      expect(await readings()).toHaveLength(1);
    });
  });

  describe('listing', () => {
    beforeEach(async () => {
      await createOk({ category: 'FUEL', amount: '80', incurredAt: day(2), vendor: 'Agil Lac 2' });
      await createOk({ category: 'TOLL', amount: '4.5', incurredAt: day(3), vendor: 'Autoroute A1' });
      await createOk({
        category: 'INSURANCE',
        amount: '650',
        incurredAt: day(10),
        description: 'Annual cover',
        vendor: 'STAR',
      });
      await createOk({
        category: 'CLEANING',
        amount: '15',
        incurredAt: day(20),
        description: '50% off wash',
      });
      await createOk({
        category: 'CLEANING',
        amount: '25',
        incurredAt: day(21),
        description: '500 points bonus',
      });
    });

    it('returns newest first with the pagination envelope', async () => {
      const { data, meta } = await list();

      expect(data.map((expense) => expense.incurredAt)).toEqual([day(21), day(20), day(10), day(3), day(2)]);
      expect(meta).toEqual({ page: 1, limit: 25, total: 5, totalPages: 1, hasNext: false });
    });

    it('pages', async () => {
      const { data, meta } = await list('?limit=2&page=2');

      expect(data.map((expense) => expense.incurredAt)).toEqual([day(10), day(3)]);
      expect(meta).toMatchObject({ total: 5, totalPages: 3, hasNext: true });
    });

    it('filters by category', async () => {
      const { data } = await list('?category=CLEANING');
      expect(data).toHaveLength(2);
    });

    it('rejects an unknown category rather than returning nothing', async () => {
      await me().get(`/vehicles/${vehicleId}/expenses?category=SNACKS`).expect(400);
    });

    it('treats from and to as inclusive', async () => {
      const { data } = await list(`?from=${day(3)}&to=${day(10)}`);
      expect(data.map((expense) => expense.category)).toEqual(['INSURANCE', 'TOLL']);
    });

    it('rejects an inverted date range', async () => {
      await me()
        .get(`/vehicles/${vehicleId}/expenses?from=${day(10)}&to=${day(3)}`)
        .expect(400);
    });

    it('searches vendor and description, ignoring case', async () => {
      expect((await list('?search=star')).data.map((expense) => expense.category)).toEqual(['INSURANCE']);
      expect((await list('?search=ANNUAL')).data.map((expense) => expense.category)).toEqual(['INSURANCE']);
    });

    /** Unescaped, `%` is a wildcard and "50%" also matches "500 points". */
    it('treats LIKE wildcards in a search as literal characters', async () => {
      const { data } = await list(`?search=${encodeURIComponent('50%')}`);
      expect(data.map((expense) => expense.description)).toEqual(['50% off wash']);
    });

    it('sorts by amount, from an allow-list', async () => {
      const { data } = await list('?sort=amount:asc');
      expect(data.map((expense) => expense.amount)).toEqual([
        '4.500',
        '15.000',
        '25.000',
        '80.000',
        '650.000',
      ]);

      await me().get(`/vehicles/${vehicleId}/expenses?sort=vendor:asc`).expect(400);
    });
  });

  describe('reading one', () => {
    it('returns it by id', async () => {
      const expense = await createOk({ amount: '12.345' });

      const { body } = await me().get(`/expenses/${expense.id}`).expect(200);
      expect(body).toMatchObject({ id: expense.id, amount: '12.345' });
    });

    it('404s for an id that does not exist, and 400s for one that is not an id', async () => {
      await me().get(`/expenses/${MISSING_ID}`).expect(404);
      await me().get('/expenses/not-a-uuid').expect(400);
    });
  });

  describe('updating', () => {
    it('changes what it is given and leaves the rest alone', async () => {
      const expense = await createOk({ category: 'REPAIR', amount: '120', vendor: 'Garage Ben Ali' });

      const { body } = await me().patch(`/expenses/${expense.id}`).send({ amount: '135.5' }).expect(200);

      expect(body).toMatchObject({ category: 'REPAIR', amount: '135.500', vendor: 'Garage Ben Ali' });
    });

    it('clears an optional field with null, and with a blank string', async () => {
      const expense = await createOk({ vendor: 'Someone', description: 'Something' });

      const { body } = await me()
        .patch(`/expenses/${expense.id}`)
        .send({ vendor: null, description: '  ' })
        .expect(200);

      expect(body).toMatchObject({ vendor: null, description: null });
    });

    it('refuses null for a field every expense must have', async () => {
      const expense = await createOk({});
      await me().patch(`/expenses/${expense.id}`).send({ amount: null }).expect(400);
    });

    it('moves the timeline reading when the mileage changes', async () => {
      const expense = await createOk({ odometerKm: 101_000, incurredAt: day(5) });

      await me().patch(`/expenses/${expense.id}`).send({ odometerKm: 102_000 }).expect(200);

      const mine = (await readings()).filter((reading) => reading.sourceId === expense.id);
      expect(mine).toEqual([expect.objectContaining({ odometerKm: 102_000 })]);
      expect(await currentOdometer()).toBe(102_000);
    });

    /**
     * Correcting a typo downwards is the common case. If the old reading were
     * still in place, the new value would be checked against it and refused.
     */
    it('lets a mileage be corrected downwards past its own old value', async () => {
      const expense = await createOk({ odometerKm: 150_000, incurredAt: day(5) });

      await me().patch(`/expenses/${expense.id}`).send({ odometerKm: 101_000 }).expect(200);

      expect(await currentOdometer()).toBe(101_000);
    });

    it('removes the reading when the mileage is cleared, and lowers the headline figure', async () => {
      const expense = await createOk({ odometerKm: 101_000, incurredAt: day(5) });

      await me().patch(`/expenses/${expense.id}`).send({ odometerKm: null }).expect(200);

      expect((await readings()).some((reading) => reading.sourceId === expense.id)).toBe(false);
      expect(await currentOdometer()).toBe(100_000);
    });

    it('re-validates the reading when only the date moves', async () => {
      await me()
        .post(`/vehicles/${vehicleId}/odometer`)
        .send({ odometerKm: 110_000, recordedAt: day(10) })
        .expect(201);
      const expense = await createOk({ odometerKm: 105_000, incurredAt: day(5) });

      // 105,000 km on the 15th would sit after a reading of 110,000 on the 10th.
      const { body } = await me()
        .patch(`/expenses/${expense.id}`)
        .send({ incurredAt: day(15) })
        .expect(400);

      expect(body.message).toContain('previous reading of 110,000 km');
      // Rolled back: the expense and its reading are exactly as they were.
      expect((await me().get(`/expenses/${expense.id}`).expect(200)).body.incurredAt).toBe(day(5));
      expect((await readings()).filter((reading) => reading.sourceId === expense.id)).toHaveLength(1);
    });
  });

  describe('deleting', () => {
    it('removes the expense', async () => {
      const expense = await createOk({});

      await me().delete(`/expenses/${expense.id}`).expect(204);
      await me().get(`/expenses/${expense.id}`).expect(404);
    });

    it('takes its reading with it, and the headline mileage falls back', async () => {
      const expense = await createOk({ odometerKm: 101_000, incurredAt: day(5) });

      await me().delete(`/expenses/${expense.id}`).expect(204);

      expect(await readings()).toEqual([expect.objectContaining({ odometerKm: 100_000, source: 'MANUAL' })]);
      expect(await currentOdometer()).toBe(100_000);
    });

    it('goes with the vehicle', async () => {
      const expense = await createOk({});

      await me().delete(`/vehicles/${vehicleId}`).expect(204);

      expect(await prisma.expense.findUnique({ where: { id: expense.id } })).toBeNull();
    });
  });

  describe('derived expenses', () => {
    /** Nothing writes these until Phase 5; inserted directly to pin the rule now. */
    const fuelDerived = () =>
      prisma.expense.create({
        data: {
          vehicleId,
          createdById: userId,
          category: 'FUEL',
          amount: '90',
          incurredAt: new Date(),
          sourceType: 'FUEL',
        },
      });

    it('refuses to edit one directly', async () => {
      const expense = await fuelDerived();

      const { body } = await me().patch(`/expenses/${expense.id}`).send({ amount: '60' }).expect(409);
      expect(body.message).toContain('fuel entry');
    });

    it('refuses to delete one directly', async () => {
      const expense = await fuelDerived();
      await me().delete(`/expenses/${expense.id}`).expect(409);
    });
  });

  describe('access', () => {
    it("answers 404 for everything about another person's vehicle and expenses", async () => {
      const expense = await createOk({});
      const stranger = as((await register('stranger@example.com')).accessToken);

      await stranger.get(`/vehicles/${vehicleId}/expenses`).expect(404);
      await stranger
        .post(`/vehicles/${vehicleId}/expenses`)
        .send({ category: 'TOLL', amount: '1' })
        .expect(404);
      await stranger.get(`/expenses/${expense.id}`).expect(404);
      await stranger.patch(`/expenses/${expense.id}`).send({ amount: '1' }).expect(404);
      await stranger.delete(`/expenses/${expense.id}`).expect(404);

      // And the stranger's 404 is word for word the one for an id that never existed.
      const foreign = await stranger.get(`/expenses/${expense.id}`);
      const missing = await stranger.get(`/expenses/${MISSING_ID}`);
      expect(foreign.body.message).toBe(missing.body.message);
    });

    it('lets a viewer read but not write', async () => {
      const expense = await createOk({});
      const viewer = await register('viewer@example.com');
      await prisma.vehicleMember.create({ data: { vehicleId, userId: viewer.user.id, role: 'VIEWER' } });
      const asViewer = as(viewer.accessToken);

      await asViewer.get(`/vehicles/${vehicleId}/expenses`).expect(200);
      await asViewer.get(`/expenses/${expense.id}`).expect(200);
      await asViewer
        .post(`/vehicles/${vehicleId}/expenses`)
        .send({ category: 'TOLL', amount: '1' })
        .expect(403);
      await asViewer.patch(`/expenses/${expense.id}`).send({ amount: '1' }).expect(403);
      await asViewer.delete(`/expenses/${expense.id}`).expect(403);
    });
  });

  describe('idempotency', () => {
    const body = { category: 'INSURANCE', amount: '650', incurredAt: day(10) };
    const withKey = (key: string, payload: Record<string, unknown> = body) =>
      me().post(`/vehicles/${vehicleId}/expenses`).set('Idempotency-Key', key).send(payload);

    it('replays a retry instead of filing the cost twice', async () => {
      const first = await withKey('submit-1').expect(201);
      const retry = await withKey('submit-1').expect(201);

      expect(retry.body.id).toBe(first.body.id);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(first.headers['idempotent-replayed']).toBeUndefined();
      expect((await list()).meta.total).toBe(1);
    });

    /**
     * The outcome a double-tap must produce. Over a local socket these tend to
     * arrive one after another, so this rarely reaches the unique-index race
     * itself — expenses.service.spec.ts forces that interleaving.
     */
    it('files one expense for five simultaneous submits', async () => {
      const responses = await Promise.all(Array.from({ length: 5 }, () => withKey('burst')));

      expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201, 201]);
      expect(new Set(responses.map((response) => (response.body as ExpenseBody).id)).size).toBe(1);
      expect((await list()).meta.total).toBe(1);
    });

    /*
     * With a mileage, each transaction also locks the vehicle for its reading.
     * Taken after the insert, that lock deadlocked against the foreign-key
     * lock the insert had just taken, and every submit but one failed with a
     * 500. Found in Phase 5, where every fuel entry carries a mileage.
     */
    it('files one expense for simultaneous submits that carry a mileage', async () => {
      const withMileage = { ...body, odometerKm: 100_500 };
      const responses = await Promise.all(Array.from({ length: 5 }, () => withKey('burst-km', withMileage)));

      expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201, 201]);
      expect((await list()).meta.total).toBe(1);
      expect((await readings()).filter((reading) => reading.source === 'EXPENSE')).toHaveLength(1);
    });

    it('refuses a key reused for a different request', async () => {
      await withKey('submit-2').expect(201);
      await withKey('submit-2', { ...body, amount: '700' }).expect(422);
    });

    it('does not resurrect an expense deleted since', async () => {
      const first = await withKey('submit-3').expect(201);
      await me().delete(`/expenses/${first.body.id}`).expect(204);

      await withKey('submit-3').expect(409);
      expect((await list()).meta.total).toBe(0);
    });

    it('rejects a malformed key', async () => {
      await withKey('has spaces in it').expect(400);
    });

    it('scopes keys per user', async () => {
      await withKey('shared-key').expect(201);

      const other = await register('other@example.com');
      const theirs = await request(httpServer(app))
        .post('/api/v1/vehicles')
        .set('Authorization', `Bearer ${other.accessToken}`)
        .send({ make: 'Kia', model: 'Picanto', year: 2022, licensePlate: '1 TUN 1', fuelType: 'PETROL' })
        .expect(201);

      const { headers } = await as(other.accessToken)
        .post(`/vehicles/${theirs.body.id}/expenses`)
        .set('Idempotency-Key', 'shared-key')
        .send(body)
        .expect(201);
      expect(headers['idempotent-replayed']).toBeUndefined();
    });
  });

  describe('the database itself', () => {
    it('refuses a non-positive amount even from a writer that skipped validation', async () => {
      await expect(
        prisma.$executeRaw`INSERT INTO expenses (id, "vehicleId", category, amount, "incurredAt", "updatedAt")
          VALUES (gen_random_uuid(), ${vehicleId}::uuid, 'OTHER', 0, now(), now())`,
      ).rejects.toThrow(/expenses_amount_positive/);
    });
  });
});
