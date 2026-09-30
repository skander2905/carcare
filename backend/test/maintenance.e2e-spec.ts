import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, httpServer, resetDatabase } from './test-app.js';

const PASSWORD = 'correct horse battery staple';
const MISSING_ID = '0192f8c1-2b3d-7e4f-8a9b-1c2d3e4f5a6b';

interface RecordBody {
  id: string;
  expenseId: string | null;
  scheduleId: string | null;
  scheduleName: string | null;
  type: string;
  performedAt: string;
  odometerKm: number;
  partsCost: string | null;
  laborCost: string | null;
  totalCost: string;
  serviceProvider: string | null;
  description: string | null;
  attachmentCount: number;
}

interface ScheduleBody {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  serviceCount: number;
  due: {
    status: string;
    km: { lastKm: number; dueAtKm: number; remainingKm: number; status: string } | null;
    time: { lastDate: string; dueDate: string; remainingDays: number; status: string } | null;
  };
}

interface ExpenseBody {
  id: string;
  amount: string;
  category: string;
  sourceType: string;
  vendor: string | null;
  description: string | null;
  odometerKm: number | null;
}

interface ReadingBody {
  odometerKm: number;
  source: string;
  sourceId: string | null;
}

describe('Maintenance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let vehicleId: string;

  /** Midday n days ago. Due status depends on today, so fixtures are relative to it. */
  const daysAgo = (n: number) => {
    const date = new Date();
    date.setUTCHours(12, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - n);
    return date.toISOString();
  };

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
    token = (await register('driver@example.com')).accessToken;

    // Bought two years ago at 100,000 km.
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
        purchaseDate: daysAgo(730),
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

  const create = (body: Record<string, unknown>) =>
    me().post(`/vehicles/${vehicleId}/maintenance`).send(body);

  const service = async (daysBack: number, odometerKm: number, extra: Record<string, unknown> = {}) =>
    (
      await create({
        type: 'OIL_CHANGE',
        performedAt: daysAgo(daysBack),
        odometerKm,
        totalCost: '150',
        ...extra,
      }).expect(201)
    ).body as RecordBody;

  const schedule = async (body: Record<string, unknown>) =>
    (await me().post(`/vehicles/${vehicleId}/maintenance-schedules`).send(body).expect(201))
      .body as ScheduleBody;

  const schedules = async (): Promise<ScheduleBody[]> =>
    (await me().get(`/vehicles/${vehicleId}/maintenance-schedules`).expect(200)).body as ScheduleBody[];

  const scheduleById = async (id: string): Promise<ScheduleBody> =>
    (await me().get(`/maintenance-schedules/${id}`).expect(200)).body as ScheduleBody;

  const expense = async (id: string): Promise<ExpenseBody> =>
    (await me().get(`/expenses/${id}`).expect(200)).body as ExpenseBody;

  const readings = async (): Promise<ReadingBody[]> =>
    ((await me().get(`/vehicles/${vehicleId}/odometer`).expect(200)).body as { data: ReadingBody[] }).data;

  /** Moves the car's current mileage, as a fill-up or manual reading would. */
  const drive = (odometerKm: number) =>
    me()
      .post(`/vehicles/${vehicleId}/odometer`)
      .send({ odometerKm, recordedAt: daysAgo(0) })
      .expect(201);

  describe('logging a service', () => {
    it('writes the record, its ledger expense and its odometer reading together', async () => {
      const record = await service(10, 110_000, {
        partsCost: '95.500',
        laborCost: '40',
        totalCost: '135.5',
        serviceProvider: 'Garage Ben Arous',
      });

      expect(record).toMatchObject({
        type: 'OIL_CHANGE',
        odometerKm: 110_000,
        partsCost: '95.500',
        laborCost: '40.000',
        totalCost: '135.500',
        attachmentCount: 0,
      });

      expect(await expense(record.expenseId!)).toMatchObject({
        amount: '135.500',
        category: 'MAINTENANCE',
        sourceType: 'MAINTENANCE',
        vendor: 'Garage Ben Arous',
        description: 'Oil change',
        odometerKm: 110_000,
      });

      expect(await readings()).toContainEqual(
        expect.objectContaining({ odometerKm: 110_000, source: 'MAINTENANCE', sourceId: record.id }),
      );
    });

    it('adds up the total from parts and labour', async () => {
      const record = await service(10, 110_000, {
        totalCost: undefined,
        partsCost: '60.250',
        laborCost: '30',
      });
      expect(record.totalCost).toBe('90.250');
    });

    it('refuses a split that does not add up, naming the sum', async () => {
      const response = await create({
        type: 'OIL_CHANGE',
        odometerKm: 110_000,
        partsCost: '60',
        laborCost: '30',
        totalCost: '95',
      }).expect(400);
      expect(response.body.message).toContain('is 90.000, not the totalCost 95');
    });

    it('keeps a free service out of the ledger, and still on the timeline', async () => {
      const record = await service(10, 110_000, {
        totalCost: '0',
        description: 'First service, under warranty',
      });

      expect(record.expenseId).toBeNull();
      expect(await prisma.expense.count({ where: { vehicleId } })).toBe(0);
      expect((await readings()).filter((r) => r.source === 'MAINTENANCE')).toHaveLength(1);
    });

    it('files tyres under their own ledger category', async () => {
      const record = await service(10, 110_000, { type: 'TIRES' });
      expect((await expense(record.expenseId!)).category).toBe('TIRES');
    });

    it('refuses the service whole when its mileage contradicts the timeline', async () => {
      await drive(120_000);
      const response = await create({
        type: 'OIL_CHANGE',
        performedAt: daysAgo(0),
        odometerKm: 90_000,
        totalCost: '150',
      });

      expect(response.status).toBe(400);
      expect(await prisma.maintenanceRecord.count()).toBe(0);
      expect(await prisma.expense.count({ where: { vehicleId } })).toBe(0);
    });

    it('refuses a schedule from another vehicle as if it did not exist', async () => {
      const other = await me()
        .post('/vehicles')
        .send({ make: 'Kia', model: 'Picanto', year: 2019, licensePlate: '1 TUN 1', fuelType: 'PETROL' })
        .expect(201);
      const foreign = (
        await me()
          .post(`/vehicles/${other.body.id as string}/maintenance-schedules`)
          .send({ type: 'OIL_CHANGE', intervalKm: 10_000 })
          .expect(201)
      ).body as ScheduleBody;

      const response = await create({
        type: 'OIL_CHANGE',
        odometerKm: 110_000,
        totalCost: '1',
        scheduleId: foreign.id,
      });
      expect(response.status).toBe(400);
      expect(response.body.message).toContain('scheduleId');
    });
  });

  describe('the ledger', () => {
    it('refuses to edit or delete a maintenance expense directly', async () => {
      const record = await service(10, 110_000);
      await me().patch(`/expenses/${record.expenseId!}`).send({ amount: '1' }).expect(409);
      await me().delete(`/expenses/${record.expenseId!}`).expect(409);
    });
  });

  describe('updating', () => {
    it('moves the expense and the reading with the record', async () => {
      const record = await service(10, 110_000);
      const updated = (
        await me()
          .patch(`/maintenance/${record.id}`)
          .send({ odometerKm: 110_500, totalCost: '175.250' })
          .expect(200)
      ).body as RecordBody;

      expect(updated.totalCost).toBe('175.250');
      expect(await expense(record.expenseId!)).toMatchObject({ amount: '175.250', odometerKm: 110_500 });
      expect((await readings()).filter((r) => r.source === 'MAINTENANCE').map((r) => r.odometerKm)).toEqual([
        110_500,
      ]);
    });

    it('adds the total up again when the split changes', async () => {
      const record = await service(10, 110_000, { totalCost: undefined, partsCost: '100', laborCost: '50' });
      const updated = (await me().patch(`/maintenance/${record.id}`).send({ partsCost: '120' }).expect(200))
        .body as RecordBody;
      expect(updated.totalCost).toBe('170.000');
    });

    it('drops the expense when a service turns out to have been free', async () => {
      const record = await service(10, 110_000);
      const updated = (await me().patch(`/maintenance/${record.id}`).send({ totalCost: '0' }).expect(200))
        .body as RecordBody;

      expect(updated.expenseId).toBeNull();
      expect(await prisma.expense.findUnique({ where: { id: record.expenseId! } })).toBeNull();
    });

    it('creates the expense when a free service gains a cost', async () => {
      const record = await service(10, 110_000, { totalCost: '0' });
      const updated = (await me().patch(`/maintenance/${record.id}`).send({ totalCost: '42' }).expect(200))
        .body as RecordBody;

      expect(updated.expenseId).not.toBeNull();
      expect(await expense(updated.expenseId!)).toMatchObject({
        amount: '42.000',
        sourceType: 'MAINTENANCE',
      });
    });

    it('refuses to make a service free while its receipts would go with the expense', async () => {
      const record = await service(10, 110_000);
      await prisma.document.create({
        data: {
          vehicleId,
          expenseId: record.expenseId,
          type: 'INVOICE',
          title: 'Invoice',
          fileName: 'invoice.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1000,
          storageKey: `test/${record.id}`,
          status: 'READY',
        },
      });

      const response = await me().patch(`/maintenance/${record.id}`).send({ totalCost: '0' }).expect(409);
      expect(response.body.message).toContain('receipts');
      expect((await me().get(`/maintenance/${record.id}`).expect(200)).body.attachmentCount).toBe(1);
    });
  });

  describe('deleting', () => {
    it('takes the expense and the reading with it', async () => {
      const record = await service(10, 110_000);
      await me().delete(`/maintenance/${record.id}`).expect(204);

      expect(await prisma.expense.count({ where: { vehicleId } })).toBe(0);
      expect((await readings()).filter((r) => r.source === 'MAINTENANCE')).toHaveLength(0);
      await me().get(`/maintenance/${record.id}`).expect(404);
    });
  });

  describe('listing', () => {
    it('filters by type and provider, newest first', async () => {
      await service(30, 105_000, { serviceProvider: 'Garage Ben Arous' });
      await service(20, 107_000, { type: 'BRAKE_PADS', serviceProvider: 'Speedy Lac' });
      await service(10, 110_000, { serviceProvider: 'garage ben arous' });

      const all = (await me().get(`/vehicles/${vehicleId}/maintenance`).expect(200)).body as {
        data: RecordBody[];
      };
      expect(all.data.map((r) => r.odometerKm)).toEqual([110_000, 107_000, 105_000]);

      const oil = (await me().get(`/vehicles/${vehicleId}/maintenance?type=OIL_CHANGE`).expect(200)).body as {
        data: RecordBody[];
      };
      expect(oil.data).toHaveLength(2);

      const speedy = (await me().get(`/vehicles/${vehicleId}/maintenance?provider=SPEEDY`).expect(200))
        .body as {
        data: RecordBody[];
      };
      expect(speedy.data.map((r) => r.type)).toEqual(['BRAKE_PADS']);
    });

    it('suggests recent workshops once each, keeping the latest spelling', async () => {
      await service(30, 105_000, { serviceProvider: 'Garage Ben Arous' });
      await service(20, 107_000, { serviceProvider: 'Speedy Lac' });
      await service(10, 110_000, { serviceProvider: 'garage ben arous' });

      const { body } = await me().get(`/vehicles/${vehicleId}/maintenance/suggestions`).expect(200);
      expect(body).toEqual({
        currentOdometerKm: 110_000,
        recentProviders: ['garage ben arous', 'Speedy Lac'],
      });
    });
  });

  describe('schedules', () => {
    it('refuses a schedule with no interval', async () => {
      const response = await me()
        .post(`/vehicles/${vehicleId}/maintenance-schedules`)
        .send({ type: 'OIL_CHANGE' })
        .expect(400);
      expect(response.body.message).toContain('intervalKm, intervalMonths or both');
    });

    it('names a schedule after its type by default', async () => {
      expect((await schedule({ type: 'CABIN_FILTER', intervalMonths: 12 })).name).toBe('Cabin filter');
    });

    it('is UNKNOWN until there is a service to count from', async () => {
      const oil = await schedule({ type: 'OIL_CHANGE', intervalKm: 10_000, intervalMonths: 12 });
      expect(oil.due).toEqual({ status: 'UNKNOWN', km: null, time: null });
    });

    it('counts from a baseline, against the current mileage', async () => {
      await drive(119_500);
      const oil = await schedule({
        type: 'OIL_CHANGE',
        intervalKm: 10_000,
        lastServiceOdometerKm: 110_000,
      });

      expect(oil.due.status).toBe('DUE_SOON');
      expect(oil.due.km).toMatchObject({ lastKm: 110_000, dueAtKm: 120_000, remainingKm: 500 });
    });

    it('restarts when a linked service is logged, and falls back to the baseline when it is deleted', async () => {
      await drive(121_500);
      const oil = await schedule({ type: 'OIL_CHANGE', intervalKm: 10_000, lastServiceOdometerKm: 110_000 });
      expect(oil.due.status).toBe('OVERDUE');

      const record = await service(0, 121_500, { scheduleId: oil.id });
      expect(record.scheduleName).toBe('Oil change');

      const serviced = await scheduleById(oil.id);
      expect(serviced.serviceCount).toBe(1);
      expect(serviced.due).toMatchObject({ status: 'UPCOMING', km: { lastKm: 121_500, dueAtKm: 131_500 } });

      await me().delete(`/maintenance/${record.id}`).expect(204);
      const restored = await scheduleById(oil.id);
      expect(restored.due).toMatchObject({ status: 'OVERDUE', km: { lastKm: 110_000 } });
    });

    it('falls due by date when the mileage is nowhere near', async () => {
      const oil = await schedule({
        type: 'OIL_CHANGE',
        intervalKm: 10_000,
        intervalMonths: 12,
        lastServiceOdometerKm: 100_000,
        lastServiceAt: daysAgo(400),
      });

      expect(oil.due.km?.status).toBe('UPCOMING');
      expect(oil.due.time?.status).toBe('OVERDUE');
      expect(oil.due.status).toBe('OVERDUE');
    });

    it('lists the most urgent first, and paused schedules last', async () => {
      await drive(115_000);
      await schedule({ type: 'TIMING_BELT', intervalKm: 100_000, lastServiceOdometerKm: 100_000 });
      await schedule({ type: 'OIL_CHANGE', intervalKm: 10_000, lastServiceOdometerKm: 100_000 });
      await schedule({
        type: 'AIR_FILTER',
        intervalKm: 10_000,
        lastServiceOdometerKm: 100_000,
        isActive: false,
      });
      await schedule({ type: 'BATTERY', intervalMonths: 48 });

      expect((await schedules()).map((s) => `${s.type}:${s.due.status}`)).toEqual([
        'OIL_CHANGE:OVERDUE',
        'BATTERY:UNKNOWN',
        'TIMING_BELT:UPCOMING',
        'AIR_FILTER:OVERDUE',
      ]);
    });

    it('refuses an edit that would leave no interval', async () => {
      const oil = await schedule({ type: 'OIL_CHANGE', intervalKm: 10_000 });
      await me().patch(`/maintenance-schedules/${oil.id}`).send({ intervalKm: null }).expect(400);
      await me()
        .patch(`/maintenance-schedules/${oil.id}`)
        .send({ intervalKm: null, intervalMonths: 12 })
        .expect(200);
    });

    it('keeps the services when a schedule is deleted', async () => {
      const oil = await schedule({ type: 'OIL_CHANGE', intervalKm: 10_000 });
      const record = await service(10, 110_000, { scheduleId: oil.id });

      await me().delete(`/maintenance-schedules/${oil.id}`).expect(204);

      const kept = (await me().get(`/maintenance/${record.id}`).expect(200)).body as RecordBody;
      expect(kept).toMatchObject({ scheduleId: null, scheduleName: null, totalCost: '150.000' });
    });
  });

  describe('access', () => {
    it("answers 404 for everything about another person's maintenance", async () => {
      const oil = await schedule({ type: 'OIL_CHANGE', intervalKm: 10_000 });
      const record = await service(10, 110_000, { scheduleId: oil.id });
      const stranger = as((await register('stranger@example.com')).accessToken);

      await stranger.get(`/vehicles/${vehicleId}/maintenance`).expect(404);
      await stranger.get(`/vehicles/${vehicleId}/maintenance/suggestions`).expect(404);
      await stranger.get(`/vehicles/${vehicleId}/maintenance-schedules`).expect(404);
      await stranger.get(`/maintenance/${record.id}`).expect(404);
      await stranger.patch(`/maintenance/${record.id}`).send({ notes: 'x' }).expect(404);
      await stranger.delete(`/maintenance/${record.id}`).expect(404);
      await stranger.get(`/maintenance-schedules/${oil.id}`).expect(404);
      await stranger.patch(`/maintenance-schedules/${oil.id}`).send({ name: 'x' }).expect(404);
      await stranger.delete(`/maintenance-schedules/${oil.id}`).expect(404);

      const foreign = await stranger.get(`/maintenance/${record.id}`);
      const missing = await stranger.get(`/maintenance/${MISSING_ID}`);
      expect(foreign.body.message).toBe(missing.body.message);
    });

    it('lets a viewer read but not write', async () => {
      const oil = await schedule({ type: 'OIL_CHANGE', intervalKm: 10_000 });
      const record = await service(10, 110_000);
      const viewer = await register('viewer@example.com');
      await prisma.vehicleMember.create({ data: { vehicleId, userId: viewer.user.id, role: 'VIEWER' } });
      const asViewer = as(viewer.accessToken);

      await asViewer.get(`/vehicles/${vehicleId}/maintenance`).expect(200);
      await asViewer.get(`/vehicles/${vehicleId}/maintenance-schedules`).expect(200);
      await asViewer
        .post(`/vehicles/${vehicleId}/maintenance`)
        .send({ type: 'OIL_CHANGE', odometerKm: 111_000, totalCost: '1' })
        .expect(403);
      await asViewer.patch(`/maintenance/${record.id}`).send({ notes: 'x' }).expect(403);
      await asViewer.delete(`/maintenance/${record.id}`).expect(403);
      await asViewer
        .post(`/vehicles/${vehicleId}/maintenance-schedules`)
        .send({ type: 'OIL_CHANGE', intervalKm: 1 })
        .expect(403);
      await asViewer.patch(`/maintenance-schedules/${oil.id}`).send({ name: 'x' }).expect(403);
      await asViewer.delete(`/maintenance-schedules/${oil.id}`).expect(403);
    });
  });

  describe('idempotency', () => {
    it('logs one service for five simultaneous submits', async () => {
      const body = { type: 'OIL_CHANGE', performedAt: daysAgo(3), odometerKm: 110_000, totalCost: '150' };
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          me().post(`/vehicles/${vehicleId}/maintenance`).set('Idempotency-Key', 'service-race').send(body),
        ),
      );

      expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      expect(new Set(responses.map((r) => (r.body as RecordBody).id)).size).toBe(1);
      expect(await prisma.maintenanceRecord.count()).toBe(1);
      expect(await prisma.expense.count({ where: { vehicleId } })).toBe(1);
    });
  });

  describe('the database', () => {
    it('refuses a schedule with neither interval, even from a writer that skipped validation', async () => {
      const oil = await schedule({ type: 'OIL_CHANGE', intervalKm: 10_000 });
      await expect(
        prisma.$executeRaw`UPDATE maintenance_schedules SET "intervalKm" = NULL WHERE id = ${oil.id}::uuid`,
      ).rejects.toThrow(/maintenance_schedules_has_interval/);
    });

    it('refuses a paid record without its expense', async () => {
      const record = await service(10, 110_000);
      await expect(
        prisma.$executeRaw`UPDATE maintenance_records SET "expenseId" = NULL WHERE id = ${record.id}::uuid`,
      ).rejects.toThrow(/maintenance_records_expense_iff_paid/);
    });
  });
});
