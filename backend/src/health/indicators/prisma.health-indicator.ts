import { Injectable } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../../prisma/prisma.service.js';
import { withTimeout } from '../../common/utils/with-timeout.js';

const PROBE_TIMEOUT_MS = 2_000;

@Injectable()
export class PrismaHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * PostgreSQL is the source of truth: if it is unreachable the API cannot do
   * anything useful, so this reports `down` and readiness fails (503).
   */
  async check<Key extends string>(key: Key): Promise<HealthIndicatorResult<Key>> {
    const session = this.healthIndicatorService.check(key);
    const startedAt = Date.now();

    try {
      await withTimeout(this.prisma.ping(), PROBE_TIMEOUT_MS, 'database probe');
      return session.up({ responseTimeMs: Date.now() - startedAt });
    } catch (error) {
      return session.down({
        responseTimeMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : 'Database unreachable',
      });
    }
  }
}
