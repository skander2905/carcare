import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, httpServer, resetDatabase } from './test-app.js';

const PASSWORD = 'correct horse battery staple';

describe('Odometer timeline (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let vehicleId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);

    const registered = await request(httpServer(app))
      .post('/api/v1/auth/register')
      .send({ email: 'driver@example.com', password: PASSWORD, displayName: 'Driver' })
      .expect(201);
    token = registered.body.accessToken;

    const vehicle = await request(httpServer(app))
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        make: 'Volkswagen',
        model: 'Golf',
        year: 2019,
        licensePlate: '123 TUN 4567',
        fuelType: 'DIESEL',
        initialOdometerKm: 120_000,
      })
      .expect(201);
    vehicleId = vehicle.body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  const record = (body: Record<string, unknown>) =>
    request(httpServer(app))
      .post(`/api/v1/vehicles/${vehicleId}/odometer`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const vehicle = async (): Promise<{ currentOdometerKm: number }> => {
    const response = await request(httpServer(app))
      .get(`/api/v1/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    return response.body as { currentOdometerKm: number };
  };

  /** The seeded reading is dated at creation time, so later dates are "after". */
  const laterIso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

  describe('recording', () => {
    it('accepts a reading above the last one', async () => {
      const { body } = await record({ odometerKm: 121_000, recordedAt: laterIso(1) }).expect(201);

      expect(body).toMatchObject({ odometerKm: 121_000, source: 'MANUAL' });
    });

    it('advances the vehicle headline figure', async () => {
      await record({ odometerKm: 121_000, recordedAt: laterIso(1) }).expect(201);

      expect((await vehicle()).currentOdometerKm).toBe(121_000);
    });

    it('rejects a reading below the one before it, and says which', async () => {
      await record({ odometerKm: 121_000, recordedAt: laterIso(1) }).expect(201);

      const response = await record({ odometerKm: 119_000, recordedAt: laterIso(2) }).expect(400);

      // An actionable message: it names the reading in the way, with its value
      // and date, so the person knows which entry to fix.
      expect(response.body.message).toMatch(/cannot be lower than the previous reading of 121,000 km/);
    });

    it('leaves the headline figure untouched when a reading is refused', async () => {
      await record({ odometerKm: 121_000, recordedAt: laterIso(1) }).expect(201);
      await record({ odometerKm: 119_000, recordedAt: laterIso(2) }).expect(400);

      // The transaction has to roll back cleanly, or a rejected write would
      // still have moved the denormalised column.
      expect((await vehicle()).currentOdometerKm).toBe(121_000);
    });

    it('accepts a backdated reading that fits between its neighbours', async () => {
      await record({ odometerKm: 122_000, recordedAt: laterIso(10) }).expect(201);

      // Entering a reading you forgot last week is the most common correction,
      // and the naive "must exceed current mileage" rule gets it wrong.
      await record({ odometerKm: 121_000, recordedAt: laterIso(5) }).expect(201);
    });

    it('rejects a backdated reading higher than the one that follows it', async () => {
      await record({ odometerKm: 122_000, recordedAt: laterIso(10) }).expect(201);

      const response = await record({ odometerKm: 130_000, recordedAt: laterIso(5) }).expect(400);

      expect(response.body.message).toMatch(/cannot be higher than the next reading of 122,000 km/);
    });

    it('does not let a backdated reading drag the headline figure down', async () => {
      await record({ odometerKm: 122_000, recordedAt: laterIso(10) }).expect(201);
      await record({ odometerKm: 121_000, recordedAt: laterIso(5) }).expect(201);

      // The headline is the furthest the car has been, not the last row typed.
      expect((await vehicle()).currentOdometerKm).toBe(122_000);
    });

    it('allows an unchanged reading — a parked car still gets logged', async () => {
      await record({ odometerKm: 120_000, recordedAt: laterIso(30) }).expect(201);
    });

    it('rejects an implausible value', async () => {
      await record({ odometerKm: -1 }).expect(400);
      await record({ odometerKm: 9_000_000 }).expect(400);
    });

    /**
     * ADR-010's first race. Two readings submitted together would otherwise both
     * read the same neighbours, both validate, and leave a timeline that
     * contradicts itself. The vehicle row is locked FOR UPDATE first.
     */
    it('serialises concurrent writes rather than letting both through', async () => {
      const results = await Promise.all([
        record({ odometerKm: 121_000, recordedAt: laterIso(1) }),
        record({ odometerKm: 121_500, recordedAt: laterIso(2) }),
        record({ odometerKm: 119_000, recordedAt: laterIso(3) }),
      ]);

      const accepted = results.filter((r) => r.status === 201);
      const rejected = results.filter((r) => r.status === 400);

      // The two ascending readings land; the one that would go backwards is
      // refused no matter which order they were serialised in.
      expect(accepted).toHaveLength(2);
      expect(rejected).toHaveLength(1);

      const { body } = await request(httpServer(app))
        .get(`/api/v1/vehicles/${vehicleId}/odometer`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Seed plus the two accepted readings, and the timeline still only counts up.
      const ascending = [...body.data].reverse().map((r: { odometerKm: number }) => r.odometerKm);
      expect(ascending).toEqual([...ascending].sort((a, b) => a - b));
    });
  });

  describe('listing', () => {
    it('returns newest first, in the documented envelope', async () => {
      await record({ odometerKm: 121_000, recordedAt: laterIso(1) }).expect(201);

      const { body } = await request(httpServer(app))
        .get(`/api/v1/vehicles/${vehicleId}/odometer`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(body.data[0].odometerKm).toBe(121_000);
      expect(body.meta).toMatchObject({ page: 1, limit: 25, total: 2, totalPages: 1, hasNext: false });
    });

    it('paginates', async () => {
      for (let day = 1; day <= 4; day += 1) {
        await record({ odometerKm: 120_000 + day * 100, recordedAt: laterIso(day) }).expect(201);
      }

      const { body } = await request(httpServer(app))
        .get(`/api/v1/vehicles/${vehicleId}/odometer?page=1&limit=2`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(body.data).toHaveLength(2);
      expect(body.meta).toMatchObject({ total: 5, totalPages: 3, hasNext: true });
    });

    it('caps the page size a client can ask for', async () => {
      await request(httpServer(app))
        .get(`/api/v1/vehicles/${vehicleId}/odometer?limit=5000`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('filters by date range', async () => {
      await record({ odometerKm: 121_000, recordedAt: laterIso(1) }).expect(201);
      await record({ odometerKm: 122_000, recordedAt: laterIso(20) }).expect(201);

      const { body } = await request(httpServer(app))
        .get(`/api/v1/vehicles/${vehicleId}/odometer?from=${laterIso(10)}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(body.data).toHaveLength(1);
      expect(body.data[0].odometerKm).toBe(122_000);
    });
  });
});
