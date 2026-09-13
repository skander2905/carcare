import { Injectable } from '@nestjs/common';
import {
  type HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { RedisService } from '../../redis/redis.service.js';
import { withTimeout } from '../../common/utils/with-timeout.js';

const PROBE_TIMEOUT_MS = 1_000;

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Redis is reported as `degraded` rather than `down` on purpose.
   *
   * Losing Redis costs us background jobs and distributed rate limiting, but
   * every read and write still works. Failing readiness would pull healthy API
   * replicas out of the load balancer and turn a partial outage into a total
   * one — so the instance stays in rotation and the impairment is visible in
   * the probe payload instead.
   */
  async check<Key extends string>(
    key: Key,
  ): Promise<HealthIndicatorResult<Key>> {
    const session = this.healthIndicatorService.check(key);
    const startedAt = Date.now();

    try {
      await withTimeout(this.redis.ping(), PROBE_TIMEOUT_MS, 'redis probe');
      return session.up({ responseTimeMs: Date.now() - startedAt });
    } catch (error) {
      return session.degraded({
        responseTimeMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : 'Redis unreachable',
      });
    }
  }
}
