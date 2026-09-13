import {
  HttpStatus,
  Logger,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger as PinoNestLogger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { ApiErrorResponse } from './common/http/api-error.js';
import {
  appConfig,
  httpConfig,
  swaggerConfig,
} from './config/configuration.js';
import {
  type AppConfig,
  type HttpConfig,
  type SwaggerConfig,
} from './config/config.types.js';

/** Reject oversized bodies before they are parsed. Documents go to S3, not here. */
const BODY_LIMIT = '1mb';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Hold startup logs until the Pino logger is installed, so boot output is
    // structured too rather than a mix of two formats.
    bufferLogs: true,
    bodyParser: true,
    rawBody: false,
  });

  app.useLogger(app.get(PinoNestLogger));

  const app_ = app.get<AppConfig>(appConfig.KEY);
  const http = app.get<HttpConfig>(httpConfig.KEY);
  const swagger = app.get<SwaggerConfig>(swaggerConfig.KEY);

  // Behind a reverse proxy, express must be told to believe X-Forwarded-* or
  // every client appears to share the proxy's IP (breaking rate limiting).
  if (http.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: true });

  app.enableCors({
    origin: http.corsOrigins,
    // Required for the httpOnly refresh-token cookie to be sent at all.
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86_400,
  });

  app.setGlobalPrefix(http.globalPrefix, {
    exclude: ['health', 'health/live', 'health/ready'],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip unknown properties, then reject if any were sent: a client
      // posting `role: "ADMIN"` at a user endpoint gets a 400, not a silent drop.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      errorHttpStatusCode: HttpStatus.BAD_REQUEST,
    }),
  );

  if (swagger.enabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('CarCare API')
        .setDescription('Personal vehicle cost, fuel and maintenance tracking.')
        .setVersion('1.0')
        .addBearerAuth(
          { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          'access-token',
        )
        .addCookieAuth(
          'carcare_refresh_token',
          { type: 'apiKey', in: 'cookie' },
          'refresh-token',
        )
        .build(),
      { extraModels: [ApiErrorResponse] },
    );

    SwaggerModule.setup(`${http.globalPrefix}/${swagger.path}`, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // Let Nest run onModuleDestroy hooks (closing the Prisma pool and the Redis
  // connection) when the orchestrator sends SIGTERM.
  app.enableShutdownHooks();

  await app.listen(http.port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(
    `CarCare API listening on port ${http.port} (${app_.nodeEnv}, role=${app_.role})`,
  );
  if (swagger.enabled) {
    logger.log(`API documentation at /${http.globalPrefix}/${swagger.path}`);
  }
}

await bootstrap();
