import { type Server } from 'node:http';
import { HttpStatus, ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module.js';
import { notFoundHandler } from '../src/common/http/not-found.handler.js';
import { authConfig } from '../src/config/configuration.js';
import { type AuthConfig } from '../src/config/config.types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * Boots the real application graph for integration tests.
 *
 * It mirrors the middleware and pipe configuration from `main.ts` on purpose:
 * a test that skips the global ValidationPipe would happily pass while the
 * deployed API rejects the same request.
 */
export async function createTestApp(
  authOverrides: Partial<AuthConfig> = {},
  configure?: (builder: TestingModuleBuilder) => void,
): Promise<INestApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] });

  // Lets a suite swap a provider that would otherwise reach the outside world.
  // The OAuth suite substitutes a stub for Google, so the flow is exercised end
  // to end without depending on Google being reachable — or on this repository
  // holding real credentials.
  configure?.(builder);

  // Lets one suite run with rate limiting on, or with a zero reuse-grace so
  // replay detection can be exercised without a ten-second sleep, while every
  // other suite keeps the real configuration.
  if (Object.keys(authOverrides).length > 0) {
    builder.overrideProvider(authConfig.KEY).useFactory({
      inject: [],
      factory: () => ({ ...authConfig(), ...authOverrides }),
    });
  }

  const moduleRef = await builder.compile();

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

/**
 * Empties the tables these suites write to.
 *
 * `TRUNCATE ... CASCADE` rather than `deleteMany`: it is one statement, it
 * ignores foreign-key ordering, and it leaves the schema in place so the next
 * test does not pay for a migration.
 */
export async function resetDatabase(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);
  // `users` cascades to vehicles, memberships and readings; naming them anyway
  // keeps the statement honest about what it destroys.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "odometer_readings", "vehicle_members", "vehicles", "oauth_accounts", "refresh_tokens", "users" CASCADE',
  );
}

/** Pulls one cookie out of a `set-cookie` header, value and attributes intact. */
export function findCookie(
  headers: Record<string, unknown>,
  name: string,
): { value: string; attributes: string } | undefined {
  const raw = headers['set-cookie'];
  const cookies = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];

  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!match) return undefined;

  const [pair, ...attributes] = match.split(';');
  return { value: pair.slice(name.length + 1), attributes: attributes.join(';') };
}
