import { connectDatabase, disconnectDatabase } from '@aisbp/database';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { connectRedis, disconnectRedis } from './lib/redis.js';

async function main(): Promise<void> {
  await Promise.all([connectDatabase(), connectRedis()]);

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT}`);
  });

  const shutdown = (signal: string): void => {
    logger.info(`Received ${signal}, shutting down`);
    server.close(() => {
      void Promise.allSettled([disconnectDatabase(), disconnectRedis()]).then(() =>
        process.exit(0),
      );
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  logger.error('Failed to start API', {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
