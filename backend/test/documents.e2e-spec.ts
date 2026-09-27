import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ObjectStorage } from '../src/storage/object-storage.js';
import { InMemoryObjectStorage } from './support/in-memory-object-storage.js';
import { createTestApp, httpServer, resetDatabase } from './test-app.js';

const PASSWORD = 'correct horse battery staple';
const MISSING_ID = '0192f8c1-2b3d-7e4f-8a9b-1c2d3e4f5a6b';

interface UploadBody {
  document: { id: string; status: string; expenseId: string | null; fileName: string; title: string };
  upload: { url: string; method: string; headers: Record<string, string> };
}

describe('Documents (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const storage = new InMemoryObjectStorage();

  let token: string;
  let vehicleId: string;
  let expenseId: string;

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
    delete: (path: string) =>
      request(httpServer(app)).delete(`/api/v1${path}`).set('Authorization', `Bearer ${bearer}`),
  });
  const me = () => as(token);

  const receipt = { fileName: 'receipt.jpg', mimeType: 'image/jpeg', sizeBytes: 250_000 };

  const requestUpload = (body: Record<string, unknown> = {}) =>
    me()
      .post(`/vehicles/${vehicleId}/documents/upload-url`)
      .send({ expenseId, ...receipt, ...body });

  /** Keys are internal and never returned by the API, so tests read them from the row. */
  const keyOf = async (documentId: string): Promise<string> =>
    (await prisma.document.findUniqueOrThrow({ where: { id: documentId } })).storageKey;

  const start = async (body: Record<string, unknown> = {}): Promise<string> =>
    ((await requestUpload(body).expect(201)).body as UploadBody).document.id;

  /** The whole happy path: sign, "upload" as the browser would, confirm. */
  const attach = async (): Promise<string> => {
    const id = await start();
    storage.put(await keyOf(id));
    await me().post(`/documents/${id}/confirm`).expect(200);
    return id;
  };

  beforeAll(async () => {
    app = await createTestApp({}, (builder) => {
      builder.overrideProvider(ObjectStorage).useValue(storage);
    });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(app);
    storage.reset();

    token = (await register('driver@example.com')).accessToken;

    const vehicle = await me()
      .post('/vehicles')
      .send({ make: 'Peugeot', model: '208', year: 2020, licensePlate: '208 TUN 2020', fuelType: 'PETROL' })
      .expect(201);
    vehicleId = vehicle.body.id;

    const expense = await me()
      .post(`/vehicles/${vehicleId}/expenses`)
      .send({ category: 'REPAIR', amount: '180', vendor: 'Garage Ben Ali' })
      .expect(201);
    expenseId = expense.body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('starting an upload', () => {
    it('creates a pending document and a URL signed for its type', async () => {
      const { body } = (await requestUpload().expect(201)) as { body: UploadBody };

      expect(body.document).toMatchObject({ status: 'PENDING_UPLOAD', expenseId, fileName: 'receipt.jpg' });
      expect(body.document.title).toBe('receipt.jpg');
      expect(body.upload).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'image/jpeg' } });
    });

    it('never builds the storage key from the file name', async () => {
      await requestUpload({ fileName: '../../other-vehicle/secret.jpg' }).expect(201);

      const [row] = await prisma.document.findMany();
      expect(row.storageKey).not.toContain('..');
      expect(row.storageKey).not.toContain('secret');
      expect(row.storageKey.startsWith(`vehicles/${vehicleId}/documents/`)).toBe(true);
    });

    it.each([
      ['an unsupported type', { mimeType: 'application/zip' }],
      ['a file over 10 MB', { sizeBytes: 10 * 1024 * 1024 + 1 }],
      ['an empty file', { sizeBytes: 0 }],
    ])('rejects %s', async (_label, body) => {
      await requestUpload(body).expect(400);
    });

    it("404s for an expense on someone else's vehicle", async () => {
      const other = await register('other@example.com');
      const theirVehicle = await as(other.accessToken)
        .post('/vehicles')
        .send({ make: 'Kia', model: 'Picanto', year: 2022, licensePlate: '1 TUN 1', fuelType: 'PETROL' })
        .expect(201);
      const theirExpense = await as(other.accessToken)
        .post(`/vehicles/${theirVehicle.body.id}/expenses`)
        .send({ category: 'TOLL', amount: '2' })
        .expect(201);

      // Attaching to their expense through my vehicle: the expense does not exist here.
      await requestUpload({ expenseId: theirExpense.body.id }).expect(404);
    });

    it('accepts a long file name, cutting only the default title', async () => {
      const fileName = `${'receipt-'.repeat(31)}x.jpg`; // 253 characters
      const { body } = (await requestUpload({ fileName }).expect(201)) as { body: UploadBody };

      expect(body.document.fileName).toBe(fileName);
      expect(body.document.title).toBe(fileName.slice(0, 200));
    });

    /** Count-then-insert without a lock let simultaneous requests overshoot. */
    it('holds the cap under simultaneous requests', async () => {
      for (let i = 0; i < 8; i++) await requestUpload().expect(201);

      const statuses = (await Promise.all(Array.from({ length: 6 }, () => requestUpload()))).map(
        (r) => r.status,
      );

      expect(statuses.filter((status) => status === 201)).toHaveLength(2);
      expect(statuses.filter((status) => status === 409)).toHaveLength(4);
      expect(await prisma.document.count({ where: { expenseId } })).toBe(10);
    });

    it('caps attachments per expense', async () => {
      for (let i = 0; i < 10; i++) await requestUpload().expect(201);
      await requestUpload().expect(409);
    });
  });

  describe('confirming', () => {
    it('refuses to confirm before the file exists, and leaves it pending', async () => {
      const id = await start();

      await me().post(`/documents/${id}/confirm`).expect(409);

      expect((await prisma.document.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING_UPLOAD');
    });

    it('marks it ready once the stored file matches, and is safe to repeat', async () => {
      const id = await start();
      storage.put(await keyOf(id));

      const first = await me().post(`/documents/${id}/confirm`).expect(200);
      const again = await me().post(`/documents/${id}/confirm`).expect(200);

      expect(first.body.status).toBe('READY');
      expect(again.body.status).toBe('READY');
    });

    it('fails and discards a stored file that differs from what was signed', async () => {
      const id = await start();
      const key = await keyOf(id);
      storage.put(key, { sizeBytes: 9_999_999 });

      await me().post(`/documents/${id}/confirm`).expect(422);

      expect((await prisma.document.findUniqueOrThrow({ where: { id } })).status).toBe('FAILED');
      expect(storage.deleted).toContain(key);
    });
  });

  describe('once attached', () => {
    it('is listed for its expense, and counted on it — pending uploads are not', async () => {
      const ready = await attach();
      await requestUpload().expect(201); // never uploaded

      const listed = await me().get(`/vehicles/${vehicleId}/documents?expenseId=${expenseId}`).expect(200);
      expect((listed.body as { id: string }[]).map((d) => d.id)).toEqual([ready]);

      const expense = await me().get(`/expenses/${expenseId}`).expect(200);
      expect(expense.body.attachmentCount).toBe(1);
    });

    it('can be downloaded through a short-lived link', async () => {
      const id = await attach();

      const { body } = (await me().get(`/documents/${id}/download-url`).expect(200)) as {
        body: { url: string; expiresAt: string };
      };
      expect(body.url).toMatch(/^memory:\/\/download\//);
      expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('offers no link while still pending', async () => {
      await me()
        .get(`/documents/${await start()}/download-url`)
        .expect(409);
    });

    it('can be removed, file and all', async () => {
      const id = await attach();
      const key = await keyOf(id);

      await me().delete(`/documents/${id}`).expect(204);

      expect(storage.deleted).toContain(key);
      expect((await me().get(`/expenses/${expenseId}`).expect(200)).body.attachmentCount).toBe(0);
    });

    it('goes with its expense, and so does the file', async () => {
      const id = await attach();
      const key = await keyOf(id);

      await me().delete(`/expenses/${expenseId}`).expect(204);

      expect(await prisma.document.count()).toBe(0);
      expect(storage.deleted).toContain(key);
    });

    it('goes with its vehicle, and so does the file', async () => {
      const id = await attach();
      const key = await keyOf(id);

      await me().delete(`/vehicles/${vehicleId}`).expect(204);

      expect(storage.deleted).toContain(key);
    });
  });

  describe('access', () => {
    it("answers 404 for someone else's documents, exactly as for missing ones", async () => {
      const { body } = (await requestUpload().expect(201)) as { body: UploadBody };
      const stranger = as((await register('stranger@example.com')).accessToken);

      const foreign = await stranger.get(`/documents/${body.document.id}/download-url`).expect(404);
      const missing = await stranger.get(`/documents/${MISSING_ID}/download-url`).expect(404);
      expect(foreign.body.message).toBe(missing.body.message);

      await stranger.post(`/vehicles/${vehicleId}/documents/upload-url`).send(receipt).expect(404);
      await stranger.delete(`/documents/${body.document.id}`).expect(404);
    });

    it('lets a viewer look but not attach or remove', async () => {
      const id = await attach();
      const viewer = await register('viewer@example.com');
      await prisma.vehicleMember.create({ data: { vehicleId, userId: viewer.user.id, role: 'VIEWER' } });
      const asViewer = as(viewer.accessToken);

      await asViewer.get(`/vehicles/${vehicleId}/documents`).expect(200);
      await asViewer.get(`/documents/${id}/download-url`).expect(200);
      await asViewer.delete(`/documents/${id}`).expect(403);
      await asViewer
        .post(`/vehicles/${vehicleId}/documents/upload-url`)
        .send({ ...receipt, expenseId })
        .expect(403);
    });
  });
});

describe('Documents without storage configured (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // The real S3 adapter with no credentials — how CI and a fresh clone boot.
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers 503 rather than failing obscurely', async () => {
    await resetDatabase(app);
    const { body } = await request(httpServer(app))
      .post('/api/v1/auth/register')
      .send({ email: 'driver@example.com', password: PASSWORD, displayName: 'Driver' })
      .expect(201);
    const auth = { Authorization: `Bearer ${body.accessToken}` };

    const vehicle = await request(httpServer(app))
      .post('/api/v1/vehicles')
      .set(auth)
      .send({ make: 'Peugeot', model: '208', year: 2020, licensePlate: '208 TUN 2020', fuelType: 'PETROL' })
      .expect(201);

    const response = await request(httpServer(app))
      .post(`/api/v1/vehicles/${vehicle.body.id}/documents/upload-url`)
      .set(auth)
      .send({ fileName: 'r.jpg', mimeType: 'image/jpeg', sizeBytes: 10 })
      .expect(503);
    expect(response.body.message).toContain('not configured');
  });
});
