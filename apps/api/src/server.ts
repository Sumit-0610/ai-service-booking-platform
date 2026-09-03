import { connectDatabase, disconnectDatabase } from '@aisbp/database';
import { createApp } from './app.js';
import { appVersion, env, hasAppVersion } from './config/env.js';
import { logger } from './lib/logger.js';
import { connectRedis, disconnectRedis } from './lib/redis.js';

async function main(): Promise<void> {
  // Milestone 18 — one line so an operator can confirm the running release from
  // the logs. Only non-secret release metadata; no connection strings.
  logger.info('Starting API', {
    nodeEnv: env.NODE_ENV,
    version: hasAppVersion ? appVersion.version : undefined,
    commit: hasAppVersion ? appVersion.commit : undefined,
    buildTime: hasAppVersion ? appVersion.buildTime : undefined,
  });

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
