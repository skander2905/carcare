import { type Server } from 'node:http';
import { HttpStatus, ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module.js';
import { notFoundHandler } from '../src/common/http/not-found.handler.js';

/**
 * Boots the real application graph for integration tests.
 *
 * It mirrors the middleware and pipe configuration from `main.ts` on purpose:
 * a test that skips the global ValidationPipe would happily pass while the
 * deployed API rejects the same request.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
  });

  app.use(cookieParser());
  app.setGlobalPrefix('api', {
    exclude: ['health', 'health/live', 'health/ready'],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      errorHttpStatusCode: HttpStatus.BAD_REQUEST,
    }),
  );

  await app.init();
  // Registered after init() for the same reason as in main.ts: it must sit
  // behind the routes so it only handles unmatched URLs.
  app.use(notFoundHandler);

  return app;
}

/**
 * `getHttpServer()` is typed `any` by Nest. Narrowing it once here keeps the
 * specs free of unsafe-argument suppressions.
 */
export function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}
