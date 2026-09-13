import type { ConfigType } from '@nestjs/config';
import type {
  appConfig,
  databaseConfig,
  httpConfig,
  loggingConfig,
  redisConfig,
  swaggerConfig,
} from './configuration.js';

/**
 * Injection-friendly aliases so services depend on a named shape rather than
 * doing stringly-typed `configService.get<string>('http.port')` lookups.
 *
 *   constructor(@Inject(httpConfig.KEY) private readonly http: HttpConfig) {}
 */
export type AppConfig = ConfigType<typeof appConfig>;
export type HttpConfig = ConfigType<typeof httpConfig>;
export type DatabaseConfig = ConfigType<typeof databaseConfig>;
export type RedisConfig = ConfigType<typeof redisConfig>;
export type LoggingConfig = ConfigType<typeof loggingConfig>;
export type SwaggerConfig = ConfigType<typeof swaggerConfig>;
