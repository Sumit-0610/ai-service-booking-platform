import { PrismaClient } from '../generated/prisma/index.js';

/**
 * Single PrismaClient for the process. In development the instance is cached on
 * `globalThis` so hot-reloading tools do not open a new connection pool on every
 * reload. This module is internal to `@aisbp/database`; application code must go
 * through the repository layer, never import PrismaClient directly.
 */
const globalForPrisma = globalThis as unknown as { aisbpPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.aisbpPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.aisbpPrisma = prisma;
}

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
