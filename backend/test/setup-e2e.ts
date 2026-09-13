/**
 * Integration-suite bootstrap.
 *
 * These tests talk to a real PostgreSQL and a real Redis — the whole point is
 * to exercise migrations, constraints and transactions, which an in-memory
 * fake cannot do. `docker compose up db redis` (or CI service containers)
 * must be running.
 */
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.SWAGGER_ENABLED ??= 'false';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Integration tests need a real database — run `docker compose up -d db redis` first.',
  );
}
