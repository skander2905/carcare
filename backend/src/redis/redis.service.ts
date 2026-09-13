import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { redisConfig } from '../config/configuration.js';
import { type RedisConfig } from '../config/config.types.js';

/**
 * Shared Redis connection for caching and rate limiting.
 *
 * BullMQ deliberately does NOT share this connection: it requires
 * `maxRetriesPerRequest: null` and holds blocking connections open, so queues
 * create their own clients (see the jobs module, Phase 7).
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(@Inject(redisConfig.KEY) config: RedisConfig) {
    this.client = new Redis(config.url, {
      // Fail a command rather than hanging a request forever when Redis is down.
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      // Back off on reconnect instead of hammering a recovering instance.
      retryStrategy: (times: number) => Math.min(times * 200, 5_000),
      lazyConnect: false,
    });

    this.client.on('error', (error: Error) => {
      // Logged, not thrown: Redis being unavailable degrades features, it does
      // not take the API down. The readiness probe reports the real state.
      this.logger.warn(`Redis connection error: ${error.message}`);
    });
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    // `quit` drains in-flight commands; `disconnect` would drop them.
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
