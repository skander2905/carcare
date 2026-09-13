import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configNamespaces } from './configuration.js';
import { validateEnv } from './env.schema.js';

/**
 * Wraps `@nestjs/config` so the rest of the application never has to know how
 * configuration is loaded — only that typed namespaces are injectable.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Docker Compose and the platform supply real environment variables;
      // .env is a local-development convenience only.
      envFilePath: ['.env.local', '.env'],
      load: configNamespaces,
      validate: validateEnv,
    }),
  ],
})
export class AppConfigModule {}
