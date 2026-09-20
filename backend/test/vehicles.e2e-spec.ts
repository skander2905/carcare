import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, httpServer, resetDatabase } from './test-app.js';

const PASSWORD = 'correct horse battery staple';

const A_VEHICLE = {
  make: 'Volkswagen',
  model: 'Golf',
  year: 2019,
  licensePlate: '123 TUN 4567',
  fuelType: 'DIESEL',
  engineSize: 1.6,
  transmission: 'MANUAL',
  initialOdometerKm: 120_000,
  purchasePrice: '38500.000',
};

describe('Vehicles (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  const server = () => httpServer(app);

  /** Registers an account and returns its bearer token. */
  async function signUp(email: string): Promise<string> {
    const { body } = await request(server())
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, displayName: 'Owner' })
      .expect(201);

    return body.accessToken as string;
  }

  const createVehicle = (token: string, overrides: Record<string, unknown> = {}) =>
    request(server())
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...A_VEHICLE, ...overrides });

  describe('POST /vehicles', () => {
    it('creates a vehicle owned by the caller', async () => {
      const token = await signUp('owner@example.com');

      const { body } = await createVehicle(token).expect(201);

      expect(body).toMatchObject({
        make: 'Volkswagen',
        model: 'Golf',
        year: 2019,
        licensePlate: '123 TUN 4567',
        fuelType: 'DIESEL',
        currentOdometerKm: 120_000,
      });
    });

    it('returns money and engine size as decimal strings, never floats', async () => {
      const token = await signUp('owner@example.com');

      const { body } = await createVehicle(token).expect(201);

      // A JSON number would round 38500.000 through a float — the exact bug the
      // numeric column exists to prevent.
      expect(body.purchasePrice).toBe('38500.000');
      expect(typeof body.purchasePrice).toBe('string');
      expect(body.engineSize).toBe('1.6');
    });

    it('seeds the odometer timeline with the starting mileage', async () => {
      const token = await signUp('owner@example.com');
      const { body: vehicle } = await createVehicle(token).expect(201);

      const { body } = await request(server())
        .get(`/api/v1/vehicles/${vehicle.id}/odometer`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // "Distance since I got the car" has to be answerable from day one.
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({ odometerKm: 120_000, source: 'MANUAL' });
    });

    it('seeds the timeline for a brand-new car at zero kilometres', async () => {
      const token = await signUp('owner@example.com');
      const { body: vehicle } = await createVehicle(token, { initialOdometerKm: 0 }).expect(201);

      const { body } = await request(server())
        .get(`/api/v1/vehicles/${vehicle.id}/odometer`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Zero is a real reading. Skipping it would leave the vehicle reporting
      // 0 km with an empty timeline, so the next entry would look like the
      // first and the distance driven in between would be lost.
      expect(body.data).toHaveLength(1);
      expect(body.data[0].odometerKm).toBe(0);
    });

    it('records no reading when the mileage was not given', async () => {
      const token = await signUp('owner@example.com');
      const { body: vehicle } = await createVehicle(token, { initialOdometerKm: undefined }).expect(201);

      const { body } = await request(server())
        .get(`/api/v1/vehicles/${vehicle.id}/odometer`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Omitted means "I do not know yet", which is different from zero.
      expect(body.data).toHaveLength(0);
      expect(vehicle.currentOdometerKm).toBe(0);
    });

    it('normalises the licence plate so one car cannot be entered twice', async () => {
      const token = await signUp('owner@example.com');
      await createVehicle(token).expect(201);

      await createVehicle(token, { licensePlate: '  123 tun 4567 ' }).expect(409);
    });

    it('lets a different person use the same plate', async () => {
      // The unique index is per owner, not global: two people can legitimately
      // register plates that collide across countries.
      const first = await signUp('first@example.com');
      const second = await signUp('second@example.com');

      await createVehicle(first).expect(201);
      await createVehicle(second).expect(201);
    });

    it('rejects an implausible year', async () => {
      const token = await signUp('owner@example.com');

      await createVehicle(token, { year: 1700 }).expect(400);
      await createVehicle(token, { year: 3000 }).expect(400);
    });

    it('rejects a VIN with the characters ISO 3779 excludes', async () => {
      const token = await signUp('owner@example.com');

      // I, O and Q are excluded precisely because they are misread as 1 and 0.
      await createVehicle(token, { vin: 'WVWZZZ1KZAW12345I' }).expect(400);
      await createVehicle(token, { vin: 'TOO-SHORT' }).expect(400);
    });

    it('rejects an unknown property rather than dropping it', async () => {
      const token = await signUp('owner@example.com');

      await createVehicle(token, { currentOdometerKm: 999_999 }).expect(400);
    });

    it('requires authentication', async () => {
      await request(server()).post('/api/v1/vehicles').send(A_VEHICLE).expect(401);
    });
  });

  describe('GET /vehicles', () => {
    it('lists only vehicles the caller can reach', async () => {
      const mine = await signUp('mine@example.com');
      const theirs = await signUp('theirs@example.com');

      await createVehicle(mine, { licensePlate: 'MINE 1' }).expect(201);
      await createVehicle(theirs, { licensePlate: 'THEIRS 1' }).expect(201);

      const { body } = await request(server())
        .get('/api/v1/vehicles')
        .set('Authorization', `Bearer ${mine}`)
        .expect(200);

      expect(body).toHaveLength(1);
      expect(body[0].licensePlate).toBe('MINE 1');
    });

    it('hides archived vehicles unless asked', async () => {
      const token = await signUp('owner@example.com');
      const { body: vehicle } = await createVehicle(token).expect(201);

      await request(server())
        .patch(`/api/v1/vehicles/${vehicle.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isArchived: true })
        .expect(200);

      const def = await request(server())
        .get('/api/v1/vehicles')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(def.body).toHaveLength(0);

      const all = await request(server())
        .get('/api/v1/vehicles?includeArchived=true')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(all.body).toHaveLength(1);
      expect(all.body[0].archivedAt).toEqual(expect.any(String));
    });
  });

  /**
   * ADR-006, end to end. Every one of these must be a 404 rather than a 403:
   * a 403 confirms the id exists, which is exactly what someone probing for
   * other people's identifiers is trying to learn.
   */
  describe('access control', () => {
    let owner: string;
    let stranger: string;
    let vehicleId: string;

    beforeEach(async () => {
      owner = await signUp('owner@example.com');
      stranger = await signUp('stranger@example.com');
      const { body } = await createVehicle(owner).expect(201);
      vehicleId = body.id;
    });

    it("hides another user's vehicle on read", async () => {
      const response = await request(server())
        .get(`/api/v1/vehicles/${vehicleId}`)
        .set('Authorization', `Bearer ${stranger}`)
        .expect(404);

      expect(response.body).toMatchObject({ statusCode: 404, error: 'NotFound' });
    });

    it("refuses to update another user's vehicle", async () => {
      await request(server())
        .patch(`/api/v1/vehicles/${vehicleId}`)
        .set('Authorization', `Bearer ${stranger}`)
        .send({ color: 'Repainted' })
        .expect(404);
    });

    it("refuses to delete another user's vehicle", async () => {
      await request(server())
        .delete(`/api/v1/vehicles/${vehicleId}`)
        .set('Authorization', `Bearer ${stranger}`)
        .expect(404);

      // And it is genuinely still there.
      await request(server())
        .get(`/api/v1/vehicles/${vehicleId}`)
        .set('Authorization', `Bearer ${owner}`)
        .expect(200);
    });

    it("hides another user's odometer timeline", async () => {
      await request(server())
        .get(`/api/v1/vehicles/${vehicleId}/odometer`)
        .set('Authorization', `Bearer ${stranger}`)
        .expect(404);
    });

    it("refuses to write to another user's timeline", async () => {
      await request(server())
        .post(`/api/v1/vehicles/${vehicleId}/odometer`)
        .set('Authorization', `Bearer ${stranger}`)
        .send({ odometerKm: 999_999 })
        .expect(404);
    });

    it('answers the same way for an id that never existed', async () => {
      // Indistinguishable from "not yours", which is the whole point.
      await request(server())
        .get('/api/v1/vehicles/0192f8c1-2b3d-7e4f-8a9b-1c2d3e4f5a6b')
        .set('Authorization', `Bearer ${stranger}`)
        .expect(404);
    });

    it('rejects a malformed id before it reaches the database', async () => {
      await request(server())
        .get('/api/v1/vehicles/not-a-uuid')
        .set('Authorization', `Bearer ${owner}`)
        .expect(400);
    });
  });

  describe('DELETE /vehicles/:id', () => {
    it('removes the vehicle and its timeline', async () => {
      const token = await signUp('owner@example.com');
      const { body: vehicle } = await createVehicle(token).expect(201);

      await request(server())
        .delete(`/api/v1/vehicles/${vehicle.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      await request(server())
        .get(`/api/v1/vehicles/${vehicle.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });
});
