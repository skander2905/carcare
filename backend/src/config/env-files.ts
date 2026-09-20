import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Absolute paths to the workspace's `.env` files, most specific first.
 *
 * Resolved from this module's own location, never from `process.cwd()`. The
 * monorepo keeps one `.env` at the repository root, but every command runs with
 * the package as its working directory — `pnpm --filter`, `nest start`, vitest
 * and the Prisma CLI all do — so a cwd-relative lookup finds nothing and every
 * variable arrives `undefined`. That failure is quiet at the point it happens
 * and only surfaces much later as "DATABASE_URL is required".
 *
 * Real environment variables always win over all of these: in Docker and in CI
 * none of the files exist and the platform supplies the values directly.
 */
export function envFilePaths(): string[] {
  // .../backend/src/config while developing, .../backend/dist/config once built.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(here, '..', '..');
  const workspaceRoot = path.resolve(packageRoot, '..');

  return [
    path.join(packageRoot, '.env.local'),
    path.join(packageRoot, '.env'),
    path.join(workspaceRoot, '.env.local'),
    path.join(workspaceRoot, '.env'),
  ];
}
