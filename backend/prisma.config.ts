import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

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
