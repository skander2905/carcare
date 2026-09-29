import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, httpServer, resetDatabase } from './test-app.js';

const PASSWORD = 'correct horse battery staple';
const MISSING_ID = '0192f8c1-2b3d-7e4f-8a9b-1c2d3e4f5a6b';
const LAC = { latitude: 36.8442, longitude: 10.2425 };

interface FuelBody {
  id: string;
  expenseId: string;
  filledAt: string;
  odometerKm: number;
  volumeLiters: string;
  pricePerLiter: string;
  totalCost: string;
  fuelType: string;
  isFullTank: boolean;
  isMissedFill: boolean;
  stationName: string | null;
  latitude: number | null;
  longitude: number | null;
  consumption: { litresPer100Km: string; distanceKm: number; litres: string; fillCount: number } | null;
  createdById: string | null;
}

interface ExpenseBody {
  id: string;
  amount: string;
  category: string;
  sourceType: string;
  vendor: string | null;
  description: string | null;
  odometerKm: number | null;
  incurredAt: string;
}

interface OfficialBody {
  effectiveFrom: string;
  prices: Record<string, { grade: string; pricePerLiter: string }[] | undefined>;
}

interface ReadingBody {
  odometerKm: number;
  source: string;
  sourceId: string | null;
}

describe('Fuel (e2e)', () => {
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

    // A petrol car bought on 1 January at 100,000 km.
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

  const create = (body: Record<string, unknown>) => me().post(`/vehicles/${vehicleId}/fuel`).send(body);

  const fill = async (
    n: number,
    odometerKm: number,
    volumeLiters: string,
    extra: Record<string, unknown> = {},
  ) =>
    (
      await create({
        filledAt: day(n),
        odometerKm,
        volumeLiters,
        // 2.500 a litre unless told otherwise, so totals are easy to check.
        totalCost: (Number(volumeLiters) * 2.5).toFixed(3),
        ...extra,
      }).expect(201)
    ).body as FuelBody;

  const list = async (query = ''): Promise<FuelBody[]> =>
    ((await me().get(`/vehicles/${vehicleId}/fuel${query}`).expect(200)).body as { data: FuelBody[] }).data;

  const expense = async (id: string): Promise<ExpenseBody> =>
    (await me().get(`/expenses/${id}`).expect(200)).body as ExpenseBody;

  const readings = async (): Promise<ReadingBody[]> =>
    ((await me().get(`/vehicles/${vehicleId}/odometer`).expect(200)).body as { data: ReadingBody[] }).data;

  const currentOdometer = async (): Promise<number> =>
    ((await me().get(`/vehicles/${vehicleId}`).expect(200)).body as { currentOdometerKm: number })
      .currentOdometerKm;

  describe('creating', () => {
    it('writes the entry, its ledger expense and its odometer reading together', async () => {
      const entry = await fill(3, 100_450, '38.2', { stationName: 'Shell Lac 2' });

      expect(entry).toMatchObject({
        odometerKm: 100_450,
        volumeLiters: '38.20',
        totalCost: '95.500',
        pricePerLiter: '2.500', // derived: none was sent
        fuelType: 'PETROL', // the vehicle's
        isFullTank: true,
        isMissedFill: false,
        createdById: userId,
      });

      expect(await expense(entry.expenseId)).toMatchObject({
        category: 'FUEL',
        sourceType: 'FUEL',
        amount: '95.500',
        vendor: 'Shell Lac 2',
        description: '38.20 L petrol',
        odometerKm: 100_450,
        incurredAt: day(3),
      });

      expect(await readings()).toContainEqual(
        expect.objectContaining({ odometerKm: 100_450, source: 'FUEL', sourceId: entry.id }),
      );
      expect(await currentOdometer()).toBe(100_450);
    });

    it('keeps a stated price that agrees with the pump, within rounding', async () => {
      const entry = await fill(3, 100_450, '38.20', { totalCost: '96.455', pricePerLiter: '2.525' });
      expect(entry.pricePerLiter).toBe('2.525');
    });

    it('refuses a price that contradicts the total and volume, and says what it should be', async () => {
      const { body } = await create({
        odometerKm: 100_450,
        volumeLiters: '38.20',
        totalCost: '96.455',
        pricePerLiter: '25.25',
      }).expect(400);

      expect(body.message).toContain('2.525 per litre');
    });

    it('refuses the fill whole when its mileage contradicts the timeline', async () => {
      await fill(10, 101_000, '30');

      // Filed on day 12 but below day 10's 101,000 km.
      await create({ filledAt: day(12), odometerKm: 100_900, volumeLiters: '20', totalCost: '50' }).expect(
        400,
      );

      expect(await list()).toHaveLength(1);
      expect(await prisma.expense.count({ where: { vehicleId } })).toBe(1);
    });

    it('refuses half a coordinate', async () => {
      await create({ odometerKm: 100_450, volumeLiters: '30', totalCost: '75', latitude: 36.8 }).expect(400);
    });

    it('refuses a numeric volume — floats lose centilitres', async () => {
      await create({ odometerKm: 100_450, volumeLiters: 30.5, totalCost: '75' }).expect(400);
    });
  });

  describe('the ledger', () => {
    it('refuses to edit or delete a fuel expense directly', async () => {
      const entry = await fill(3, 100_450, '30');

      const { body } = await me().patch(`/expenses/${entry.expenseId}`).send({ amount: '1' }).expect(409);
      expect(body.message).toContain('fuel entry');
      await me().delete(`/expenses/${entry.expenseId}`).expect(409);
    });

    it('lists fuel alongside manual costs, so totals include it', async () => {
      await fill(3, 100_450, '30');
      const { body } = await me().get(`/vehicles/${vehicleId}/expenses?category=FUEL`).expect(200);
      expect(body.meta.total).toBe(1);
    });
  });

  describe('consumption', () => {
    it('counts every partial fill in a full-to-full window', async () => {
      // ADR-012's example: 10 + 15 + 20 litres over 600 km is 7.50 L/100km.
      await fill(2, 100_500, '42');
      await fill(4, 100_700, '10', { isFullTank: false });
      await fill(6, 100_900, '15', { isFullTank: false });
      const closing = await fill(8, 101_100, '20');

      const entries = await list();
      const byId = new Map(entries.map((e) => [e.id, e]));

      expect(byId.get(closing.id)?.consumption).toMatchObject({
        litresPer100Km: '7.50',
        distanceKm: 600,
        litres: '45.00',
        fillCount: 3,
      });
      // Partials, and the first full tank, have nothing to report.
      expect(entries.filter((e) => e.consumption === null)).toHaveLength(3);
    });

    it('reports no figure across a missed fill', async () => {
      await fill(2, 100_500, '42');
      const after = await fill(8, 101_100, '30', { isMissedFill: true });

      const entry = (await list()).find((e) => e.id === after.id);
      expect(entry?.consumption).toBeNull();
    });

    it('summarises a period, weighted by distance', async () => {
      await fill(2, 100_000, '40');
      await fill(5, 100_060, '6.6'); // 11 L/100km over 60 km
      await fill(20, 100_960, '54'); // 6 L/100km over 900 km

      const { body } = await me().get(`/vehicles/${vehicleId}/analytics/consumption`).expect(200);

      expect(body.summary).toMatchObject({
        averageLitresPer100Km: '6.31', // 60.6 / 960 — not the 8.5 a mean of figures gives
        measuredDistanceKm: 960,
        windowCount: 2,
        fillCount: 3,
        totalLitres: '100.60',
        totalCost: '251.500',
        averagePricePerLiter: '2.500',
        costPerKm: '0.158',
      });
      expect(body.windows).toHaveLength(2);
    });

    it('keeps windows by the day they closed', async () => {
      await fill(2, 100_000, '40');
      await fill(5, 100_060, '6.6');
      await fill(20, 100_960, '54');

      const { body } = await me()
        .get(`/vehicles/${vehicleId}/analytics/consumption?from=${day(10)}&to=${day(25)}`)
        .expect(200);

      expect(body.summary).toMatchObject({ windowCount: 1, measuredDistanceKm: 900, fillCount: 1 });
    });

    it('is an honest blank with one fill', async () => {
      await fill(2, 100_500, '42');
      const { body } = await me().get(`/vehicles/${vehicleId}/analytics/consumption`).expect(200);
      expect(body.summary).toMatchObject({ averageLitresPer100Km: null, costPerKm: null, windowCount: 0 });
    });
  });

  describe('listing', () => {
    it('filters by fuel type and station, ignoring case and wildcards', async () => {
      await fill(2, 100_300, '30', { stationName: 'Shell Lac 2' });
      await fill(4, 100_600, '30', { stationName: 'Agil 100%', fuelType: 'LPG' });

      expect((await list('?fuelType=LPG')).map((e) => e.stationName)).toEqual(['Agil 100%']);
      expect((await list('?station=shell')).map((e) => e.stationName)).toEqual(['Shell Lac 2']);
      expect(await list('?station=%25')).toHaveLength(1); // a literal %, not "anything"
    });

    it('rejects an inverted date range', async () => {
      await me()
        .get(`/vehicles/${vehicleId}/fuel?from=${day(5)}&to=${day(1)}`)
        .expect(400);
    });
  });

  describe('updating', () => {
    it('re-derives the price and moves the expense with the figures', async () => {
      const entry = await fill(3, 100_450, '30');

      const { body } = await me()
        .patch(`/fuel/${entry.id}`)
        .send({ volumeLiters: '40', totalCost: '101' })
        .expect(200);

      expect(body).toMatchObject({ volumeLiters: '40.00', totalCost: '101.000', pricePerLiter: '2.525' });
      expect(await expense(entry.expenseId)).toMatchObject({
        amount: '101.000',
        description: '40.00 L petrol',
      });
    });

    it('moves the reading when the mileage changes', async () => {
      const entry = await fill(3, 100_450, '30');
      await me().patch(`/fuel/${entry.id}`).send({ odometerKm: 100_470 }).expect(200);

      const fuelReadings = (await readings()).filter((r) => r.source === 'FUEL');
      expect(fuelReadings).toEqual([expect.objectContaining({ odometerKm: 100_470, sourceId: entry.id })]);
      expect((await expense(entry.expenseId)).odometerKm).toBe(100_470);
    });

    it('rolls everything back when the new mileage contradicts the timeline', async () => {
      await fill(10, 101_000, '30');
      const entry = await fill(12, 101_300, '30');

      await me().patch(`/fuel/${entry.id}`).send({ odometerKm: 100_900, totalCost: '80' }).expect(400);

      expect((await me().get(`/fuel/${entry.id}`).expect(200)).body).toMatchObject({
        odometerKm: 101_300,
        totalCost: '75.000',
      });
      expect((await expense(entry.expenseId)).amount).toBe('75.000');
    });

    it('forgets the location when both coordinates are cleared', async () => {
      const entry = await fill(3, 100_450, '30', LAC);
      const { body } = await me()
        .patch(`/fuel/${entry.id}`)
        .send({ latitude: null, longitude: null })
        .expect(200);
      expect(body).toMatchObject({ latitude: null, longitude: null });
    });
  });

  describe('deleting', () => {
    it('takes the expense and the reading with it', async () => {
      await fill(3, 100_450, '30');
      const latest = await fill(9, 100_900, '30');

      await me().delete(`/fuel/${latest.id}`).expect(204);

      await me().get(`/fuel/${latest.id}`).expect(404);
      await me().get(`/expenses/${latest.expenseId}`).expect(404);
      expect((await readings()).some((r) => r.sourceId === latest.id)).toBe(false);
      expect(await currentOdometer()).toBe(100_450);
    });

    it('goes with the vehicle', async () => {
      await fill(3, 100_450, '30');
      await me().delete(`/vehicles/${vehicleId}`).expect(204);
      expect(await prisma.fuelEntry.count()).toBe(0);
    });
  });

  describe('suggestions', () => {
    it('knows the fuel type, last price, stations and usual amounts', async () => {
      await fill(2, 100_300, '20', { totalCost: '50', stationName: 'Shell Lac 2', ...LAC });
      await fill(5, 100_600, '19.8', { totalCost: '50', stationName: 'Agil La Marsa' });
      await fill(8, 100_900, '30', { totalCost: '75.750', pricePerLiter: '2.525' });

      const { body } = await me()
        .get(`/vehicles/${vehicleId}/fuel/suggestions?lat=${LAC.latitude + 0.0003}&lng=${LAC.longitude}`)
        .expect(200);

      expect(body).toMatchObject({
        fuelType: 'PETROL',
        currentOdometerKm: 100_900,
        lastFill: { odometerKm: 100_900, filledAt: day(8) },
        lastPrices: { PETROL: '2.525' },
        recentStations: ['Agil La Marsa', 'Shell Lac 2'],
        usualAmounts: ['50.000'],
      });
      expect(body.nearbyStations).toEqual([{ name: 'Shell Lac 2', distanceMeters: expect.any(Number) }]);
    });

    it('works for a vehicle with no fills', async () => {
      const { body } = await me().get(`/vehicles/${vehicleId}/fuel/suggestions`).expect(200);
      expect(body).toMatchObject({ lastFill: null, lastPrices: {}, nearbyStations: [], usualAmounts: [] });
    });

    it("offers the state's pump prices, exact, for a vehicle priced in dinars", async () => {
      const { body } = await me().get(`/vehicles/${vehicleId}/fuel/suggestions`).expect(200);
      const official = (body as { officialPrices: OfficialBody }).officialPrices;

      expect(official.effectiveFrom).toBe('2022-11-24');
      expect(official.prices.PETROL?.[0]).toEqual({ grade: 'Sans plomb', pricePerLiter: '2.525' });
      expect(official.prices.DIESEL?.map((g) => g.grade)).toContain('Gasoil ordinaire');
    });

    it('offers none when the owner counts in another currency', async () => {
      await me().patch('/users/me').send({ currency: 'EUR' }).expect(200);
      const { body } = await me().get(`/vehicles/${vehicleId}/fuel/suggestions`).expect(200);
      expect(body.officialPrices).toBeNull();
    });
  });

  describe('access', () => {
    it("answers 404 for everything about another person's fuel log", async () => {
      const entry = await fill(3, 100_450, '30');
      const stranger = as((await register('stranger@example.com')).accessToken);

      await stranger.get(`/vehicles/${vehicleId}/fuel`).expect(404);
      await stranger.get(`/vehicles/${vehicleId}/fuel/suggestions`).expect(404);
      await stranger.get(`/vehicles/${vehicleId}/analytics/consumption`).expect(404);
      await stranger.get(`/fuel/${entry.id}`).expect(404);
      await stranger.patch(`/fuel/${entry.id}`).send({ notes: 'x' }).expect(404);
      await stranger.delete(`/fuel/${entry.id}`).expect(404);

      const foreign = await stranger.get(`/fuel/${entry.id}`);
      const missing = await stranger.get(`/fuel/${MISSING_ID}`);
      expect(foreign.body.message).toBe(missing.body.message);
    });

    it('lets a viewer read but not write', async () => {
      const entry = await fill(3, 100_450, '30');
      const viewer = await register('viewer@example.com');
      await prisma.vehicleMember.create({ data: { vehicleId, userId: viewer.user.id, role: 'VIEWER' } });
      const asViewer = as(viewer.accessToken);

      await asViewer.get(`/vehicles/${vehicleId}/fuel`).expect(200);
      await asViewer.get(`/fuel/${entry.id}`).expect(200);
      await asViewer
        .post(`/vehicles/${vehicleId}/fuel`)
        .send({ odometerKm: 100_500, volumeLiters: '1', totalCost: '2.5' })
        .expect(403);
      await asViewer.patch(`/fuel/${entry.id}`).send({ notes: 'x' }).expect(403);
      await asViewer.delete(`/fuel/${entry.id}`).expect(403);
    });
  });

  describe('idempotency', () => {
    const body = { filledAt: day(3), odometerKm: 100_450, volumeLiters: '30', totalCost: '75' };
    const withKey = (key: string) =>
      me().post(`/vehicles/${vehicleId}/fuel`).set('Idempotency-Key', key).send(body);

    it('replays a retry instead of logging the fill twice', async () => {
      const first = await withKey('fill-1').expect(201);
      const retry = await withKey('fill-1').expect(201);

      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.body.id).toBe(first.body.id);
      expect(await prisma.expense.count({ where: { vehicleId } })).toBe(1);
    });

    it('logs one fill for five simultaneous submits', async () => {
      const responses = await Promise.all(Array.from({ length: 5 }, () => withKey('fill-race')));

      expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      expect(new Set(responses.map((r) => (r.body as FuelBody).id)).size).toBe(1);
      expect(await prisma.fuelEntry.count()).toBe(1);
      expect((await readings()).filter((r) => r.source === 'FUEL')).toHaveLength(1);
    });
  });

  describe('the database', () => {
    it('refuses a non-positive volume even from a writer that skipped validation', async () => {
      const entry = await fill(3, 100_450, '30');
      await expect(
        prisma.$executeRaw`UPDATE fuel_entries SET "volumeLiters" = 0 WHERE id = ${entry.id}::uuid`,
      ).rejects.toThrow(/fuel_entries_volume_positive/);
    });
  });
});
