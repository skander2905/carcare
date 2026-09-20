import { config as loadEnvFiles } from 'dotenv';
import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { envFilePaths } from './src/config/env-files.js';

// The CLI runs with `backend/` as its working directory, so `dotenv/config`
// alone would look for a file that does not exist there and leave the
// datasource URL empty.
loadEnvFiles({ path: envFilePaths(), quiet: true });

/**
 * Prisma 7 moved the migration connection URL out of `schema.prisma` and into
 * this file. The runtime connection is separate: `PrismaService` constructs a
 * `PrismaPg` driver adapter (see src/prisma/prisma.service.ts), so the schema
 * itself never embeds credentials.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  datasource: {
    url: process.env.DATABASE_URL ?? '',
    // A separate scratch database Prisma uses to detect schema drift.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
