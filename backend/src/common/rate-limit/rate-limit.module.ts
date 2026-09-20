import { Global, Module } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service.js';

/**
 * The guard itself is registered globally by `AuthModule`; this only publishes
 * the service, so any module can declare `@RateLimit()` rules without wiring.
 */
@Global()
@Module({
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
