import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { buildLoggerOptions } from './common/logging/logger.options.js';
import { AppConfigModule } from './config/config.module.js';
import { loggingConfig } from './config/configuration.js';
import { type LoggingConfig } from './config/config.types.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';

/**
 * Composition root.
 *
 * Order matters: configuration is validated before anything else is
 * constructed, so a misconfigured process fails at boot with a readable
 * message instead of at the first request with an undefined.
 */
@Module({
  imports: [
    AppConfigModule,

    LoggerModule.forRootAsync({
      inject: [loggingConfig.KEY],
      useFactory: (logging: LoggingConfig) =>
        buildLoggerOptions({
          level: logging.level,
          pretty: logging.pretty,
          quietPaths: ['/health'],
        }),
    }),

    PrismaModule,
    RedisModule,

    HealthModule,
  ],
  providers: [
    // Registered through DI rather than `app.useGlobalFilters(new ...)` so the
    // filter can inject the logger and configuration like any other provider.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
