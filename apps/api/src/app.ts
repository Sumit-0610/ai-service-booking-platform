import { healthResponseSchema } from '@aisbp/shared';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.WEB_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json());

  app.get('/api/v1/health', (_req, res) => {
    const response = healthResponseSchema.parse({
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
    });

    res.status(200).json(response);
  });

  return app;
}
