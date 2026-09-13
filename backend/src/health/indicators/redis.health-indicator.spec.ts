import { HealthIndicatorService } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { RedisService } from '../../redis/redis.service.js';
import { RedisHealthIndicator } from './redis.health-indicator.js';

/**
 * Also acts as the project's dependency-injection smoke test: it builds a real
 * Nest testing module, so a regression in decorator-metadata emission (which
 * Nest's constructor injection depends on) fails here rather than at runtime.
 */
async function buildIndicator(ping: () => Promise<string>) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      RedisHealthIndicator,
      HealthIndicatorService,
      { provide: RedisService, useValue: { ping } },
    ],
  }).compile();

  return moduleRef.get(RedisHealthIndicator);
}

describe('RedisHealthIndicator', () => {
  it('reports up when Redis answers PING', async () => {
    const indicator = await buildIndicator(() => Promise.resolve('PONG'));

    const result = await indicator.check('redis');

    expect(result.redis.status).toBe('up');
  });

  it('reports degraded — not down — when Redis is unreachable', async () => {
    // The deliberate choice: losing Redis costs background jobs and rate
    // limiting, but reads and writes still work. Failing readiness here would
    // evict healthy replicas and escalate a partial outage into a total one.
    const indicator = await buildIndicator(() =>
      Promise.reject(new Error('connection refused')),
    );

    const result = await indicator.check('redis');

    expect(result.redis.status).toBe('degraded');
    expect(result.redis).toMatchObject({ message: 'connection refused' });
  });

  it('degrades rather than hanging when Redis accepts but never answers', async () => {
    const indicator = await buildIndicator(
      () => new Promise<string>(() => undefined),
    );

    const result = await indicator.check('redis');

    expect(result.redis.status).toBe('degraded');
    expect(String((result.redis as { message?: string }).message)).toContain(
      'timed out',
    );
  }, 10_000);

  it('records how long the probe took', async () => {
    const indicator = await buildIndicator(() => Promise.resolve('PONG'));

    const result = await indicator.check('redis');

    expect(result.redis).toMatchObject({ responseTimeMs: expect.any(Number) });
  });
});
