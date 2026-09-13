import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, httpServer } from './test-app.js';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /health/live answers without touching any dependency', async () => {
    const response = await request(httpServer(app)).get('/health/live').expect(200);

    expect(response.body).toMatchObject({ status: 'ok' });
    expect(response.body.uptimeSeconds).toEqual(expect.any(Number));
  });

  it('GET /health reports both dependencies', async () => {
    const response = await request(httpServer(app)).get('/health');

    // 503 is a valid answer: it means a dependency is genuinely down, which is
    // still a successful measurement.
    expect([200, 503]).toContain(response.status);

    // Terminus splits passing indicators into `info` and failing ones into
    // `error`; `details` always carries the full set, so assert against that.
    expect(response.body.details).toHaveProperty('database');
    expect(response.body.details).toHaveProperty('redis');
  });

  it('GET /health/ready returns 200 when PostgreSQL is reachable', async () => {
    const response = await request(httpServer(app)).get('/health/ready').expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.details.database.status).toBe('up');
  });

  it('health endpoints stay outside the versioned /api prefix', async () => {
    await request(httpServer(app)).get('/api/v1/health').expect(404);
  });

  it('unknown routes return the standard error envelope', async () => {
    const response = await request(httpServer(app)).get('/api/v1/does-not-exist').expect(404);

    expect(response.body).toMatchObject({ statusCode: 404, error: 'NotFound' });
    expect(response.body.timestamp).toEqual(expect.any(String));
  });
});
