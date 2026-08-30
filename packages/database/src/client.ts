import { PrismaClient } from '../generated/prisma/index.js';

/**
 * Single PrismaClient for the process. In development the instance is cached on
 * `globalThis` so hot-reloading tools do not open a new connection pool on every
 * reload. This module is internal to `@aisbp/database`; application code must go
 * through the repository layer, never import PrismaClient directly.
 */
const globalForPrisma = globalThis as unknown as { aisbpPrisma?: PrismaClient };

function resolveLogLevels(): ('warn' | 'error')[] {
  // Tests deliberately exercise failure paths (duplicate email, etc.); keep
  // their output clean.
  if (process.env.NODE_ENV === 'test') {
    return [];
  }
  return process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'];
}

export const prisma: PrismaClient =
  globalForPrisma.aisbpPrisma ?? new PrismaClient({ log: resolveLogLevels() });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.aisbpPrisma = prisma;
}

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
