import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RedisService } from '../src/redis/redis.service.js';
import { createTestApp, httpServer, resetDatabase } from './test-app.js';

const PASSWORD = 'correct horse battery staple';

/**
 * Exercises the Lua sliding window against a real Redis.
 *
 * A unit test with a fake Redis would prove the guard calls the script; only
 * this proves the script itself counts, expires and reports correctly — which
 * is the part that is actually hard to get right.
 */
describe('Rate limiting (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ rateLimitEnabled: true });
  });

  beforeEach(async () => {
    await resetDatabase(app);

    // Windows here are minutes to hours long, so a previous run's counters
    // would otherwise leak into this one and fail it for the wrong reason.
    const redis = app.get(RedisService);
    const keys = await redis.client.keys('ratelimit:*');
    if (keys.length > 0) await redis.client.del(...keys);
  });

  afterAll(async () => {
    await app?.close();
  });

  const login = (email = 'nobody@example.com') =>
    request(httpServer(app)).post('/api/v1/auth/login').send({ email, password: PASSWORD });

  it('allows requests up to the limit, then refuses with 429', async () => {
    // Five failed attempts per address per five minutes.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login('target@example.com').expect(401);
    }

    const blocked = await login('target@example.com').expect(429);

    expect(blocked.body).toMatchObject({ statusCode: 429, error: 'TooManyRequests' });
  });

  it('tells the client when to come back', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login('target@example.com');
    }

    const blocked = await login('target@example.com').expect(429);

    const retryAfter = Number(blocked.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(300);
  });

  it('advertises the remaining allowance on a permitted request', async () => {
    const response = await login('target@example.com').expect(401);

    expect(Number(response.headers['x-ratelimit-remaining'])).toBeLessThan(
      Number(response.headers['x-ratelimit-limit']),
    );
  });

  it('counts each account separately', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login('first@example.com');
    }
    await login('first@example.com').expect(429);

    // A different address shares the IP budget but not the account budget, and
    // the IP allowance (10/minute) is not spent yet.
    await login('second@example.com').expect(401);
  });

  it('blocks on the IP rule even when every attempt names a different account', async () => {
    // Ten per minute per IP: the rule that makes an account-spraying attack
    // from one host as expensive as attacking a single account.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await login(`spray-${attempt}@example.com`);
    }

    await login('spray-fresh@example.com').expect(429);
  });

  it('leaves unlimited routes alone', async () => {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await request(httpServer(app)).get('/health/live').expect(200);
    }
  });
});
