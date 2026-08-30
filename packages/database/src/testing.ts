/**
 * Test-only entry point. Exposes the raw Prisma client for fixture setup and
 * teardown in other packages' tests. Application code must import from
 * `@aisbp/database` (the repository layer), never from here.
 */
export { prisma } from './client.js';
