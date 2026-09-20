/**
 * Integration-suite bootstrap.
 *
 * These tests talk to a real PostgreSQL and a real Redis — the whole point is
 * to exercise migrations, constraints and transactions, which an in-memory
 * fake cannot do. `docker compose up db redis` (or CI service containers)
 * must be running.
 */
import { config as loadEnvFiles } from 'dotenv';
import { envFilePaths } from '../src/config/env-files.js';

/**
 * What the caller actually asked for, captured before any file is read.
 *
 * Three sources feed this process, and they are not equal: real environment
 * variables are a deliberate instruction (CI sets them, and so does
 * `DATABASE_URL=... pnpm test:e2e`), whereas a developer's `.env` describes how
 * they run the *application*, not how the suite must behave. Without this
 * snapshot the two are indistinguishable once dotenv has run.
 */
const explicit = { ...process.env };

// Same reason as prisma.config.ts: vitest runs from the package directory,
// while the workspace keeps its .env at the repository root.
loadEnvFiles({ path: envFilePaths(), quiet: true });

/**
 * Pins a setting the suite depends on: an explicit environment variable still
 * wins, but a value picked up from a `.env` file cannot silently change how the
 * tests run. Assignment, not `??=` — the variable is already populated by then.
 */
function pin(key: string, fallback: string): void {
  process.env[key] = explicit[key] ?? fallback;
}

process.env.NODE_ENV = 'test';

pin('LOG_LEVEL', 'silent');
pin('LOG_PRETTY', 'false');
pin('SWAGGER_ENABLED', 'false');

// Signs tokens that never leave this process.
pin('JWT_ACCESS_SECRET', 'integration-suite-signing-key-not-a-secret');
// Plain HTTP in tests: a Secure cookie would be dropped before it was stored.
pin('REFRESH_COOKIE_SECURE', 'false');

/*
 * Off by default, and switched back on per-suite by `createTestApp`.
 *
 * The real limits are deliberately tight — five registrations per IP per hour —
 * and every test shares 127.0.0.1, so leaving it on globally means the sixth
 * test in a file fails with a 429 that has nothing to do with what it asserts.
 * `rate-limit.e2e-spec.ts` turns it on and tests it properly.
 */
pin('AUTH_RATE_LIMIT_ENABLED', 'false');

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Integration tests need a real database — run `docker compose up -d db redis` first.',
  );
}

/*
 * The suites truncate `users` and `refresh_tokens` between tests, so pointing
 * them at a development database silently destroys real data. Requiring the
 * name to say `test` makes that impossible by accident — an explicit
 * `ALLOW_DESTRUCTIVE_TEST_DB=1` is the deliberate way out.
 */
const databaseName = process.env.DATABASE_URL.split('?')[0]?.split('/').pop() ?? '';

if (!/test/i.test(databaseName) && process.env.ALLOW_DESTRUCTIVE_TEST_DB !== '1') {
  throw new Error(
    `Refusing to run: DATABASE_URL points at "${databaseName}", which is not a test database.\n` +
      'These suites TRUNCATE users and refresh_tokens between tests.\n\n' +
      "Create one once:   psql -c 'CREATE DATABASE carcare_test'\n" +
      "Then run:          DATABASE_URL='postgresql://carcare:carcare@localhost:5432/carcare_test?schema=public' pnpm test:e2e\n\n" +
      'Set ALLOW_DESTRUCTIVE_TEST_DB=1 only if you genuinely mean to wipe that database.',
  );
}
