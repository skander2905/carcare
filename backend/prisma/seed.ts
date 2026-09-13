/**
 * Development seed.
 *
 * Idempotent by design: it upserts on natural keys so running it repeatedly
 * against an existing database is safe. It is never executed in production.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const DEMO_EMAIL = 'demo@carcare.app';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required to seed');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    // Password hashing lands with the auth module in Phase 2; until then the
    // seed only establishes the demo account row.
    const user = await prisma.user.upsert({
      where: { email: DEMO_EMAIL },
      update: {},
      create: {
        email: DEMO_EMAIL,
        displayName: 'Demo Driver',
        passwordHash: 'placeholder-until-phase-2',
        currency: 'TND',
      },
    });

    console.info(`Seeded user ${user.email} (${user.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
