import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';
import { Public } from '../auth/decorators/public.decorator.js';
import { PrismaHealthIndicator } from './indicators/prisma.health-indicator.js';
import { RedisHealthIndicator } from './indicators/redis.health-indicator.js';

/**
 * Three probes, because orchestrators ask three different questions.
 *
 * - `/live`  — "is the process wedged?" Never touches a dependency, so a
 *              database outage cannot cause a restart loop.
 * - `/ready` — "should traffic be routed here?" Checks dependencies.
 * - `/`      — the human-facing summary.
 */
@ApiTags('health')
// VERSION_NEUTRAL + excluded from the global prefix: probe URLs must not move
// when the API is versioned, or every orchestrator config breaks on a release.
@Controller({ path: 'health', version: VERSION_NEUTRAL })
// Probes are called by the orchestrator, which holds no credentials — and a
// readiness check that can fail on an auth problem would take healthy replicas
// out of rotation for a reason unrelated to their health.
@Public()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: PrismaHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Full health summary (API, database, Redis)' })
  @ApiOkResponse({
    description: 'Aggregated status of the API and its dependencies.',
  })
  check(): Promise<HealthCheckResult> {
    return this.health.check([() => this.database.check('database'), () => this.redis.check('redis')]);
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — process is running' })
  @ApiOkResponse({
    description: 'The process is up and the event loop is responsive.',
  })
  live(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe — dependencies reachable' })
  @ApiOkResponse({
    description: 'Returns 503 when PostgreSQL is unreachable; Redis only degrades.',
  })
  ready(): Promise<HealthCheckResult> {
    return this.health.check([() => this.database.check('database'), () => this.redis.check('redis')]);
  }
}
