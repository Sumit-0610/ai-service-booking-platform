import { execSync } from 'node:child_process';
import { Redis } from 'ioredis';
import { e2eEnv } from './playwright.config';

/**
 * Reset the world before the E2E run so the specs are deterministic and
 * order-independent:
 *
 * 1. `migrate deploy` — ensure the schema is current (safe, non-destructive).
 * 2. Delete every row the E2E specs could have created in a previous run
 *    (bookings + history, then non-seed users and their addresses).
 * 3. Re-run the idempotent seed — this also rebuilds the availability slots,
 *    so every seeded slot is `available` again.
 * 4. Flush the Redis logical DB the E2E API server uses.
 */
async function globalSetup(): Promise<void> {
  process.env.DATABASE_URL = e2eEnv.DATABASE_URL;
  const env = { ...process.env, DATABASE_URL: e2eEnv.DATABASE_URL };

  execSync('pnpm --filter @aisbp/database run db:migrate:deploy', { stdio: 'inherit', env });

  const { prisma } = await import('@aisbp/database/testing');
  await prisma.bookingStatusHistory.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.address.deleteMany({ where: { NOT: { id: { startsWith: 'seed-' } } } });
  await prisma.user.deleteMany({ where: { NOT: { id: { startsWith: 'seed-' } } } });
  await prisma.$disconnect();

  execSync('pnpm --filter @aisbp/database run db:seed', { stdio: 'inherit', env });

  // E2E fixture: qualify Tomas for Wi-Fi mesh too, so a booking made on Tara's
  // slot can be *reassigned* to a different qualified technician — the flow the
  // operations and technician journeys exercise. Idempotent; scoped to E2E.
  const { prisma: prisma2 } = await import('@aisbp/database/testing');
  await prisma2.technicianService.upsert({
    where: {
      technicianId_serviceId: {
        technicianId: 'seed-technician-tomas',
        serviceId: 'seed-service-wifi-mesh',
      },
    },
    create: { technicianId: 'seed-technician-tomas', serviceId: 'seed-service-wifi-mesh' },
    update: {},
  });
  await prisma2.$disconnect();

  const redis = new Redis(e2eEnv.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
  await redis.connect();
  await redis.flushdb();
  await redis.quit();
}

export default globalSetup;
