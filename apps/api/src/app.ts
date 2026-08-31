import { healthResponseSchema } from '@aisbp/shared';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { addressRouter } from './modules/addresses/address-routes.js';
import { authRouter } from './modules/auth/auth-routes.js';
import {
  publicAvailabilityRouter,
  technicianAvailabilityRouter,
} from './modules/availability/availability-routes.js';
import { bookingRouter, technicianBookingRouter } from './modules/bookings/booking-routes.js';
import { catalogueRouter } from './modules/catalogue/catalogue-routes.js';
import { operationsRouter } from './modules/operations/operations-routes.js';
import { pricingRouter } from './modules/pricing/pricing-routes.js';
import {
  operationsTechnicianRouter,
  technicianProfileRouter,
} from './modules/technicians/technician-routes.js';

export function createApp() {
  const app = express();

  if (env.TRUST_PROXY) {
    // Trust the first proxy hop so `req.ip` (used for rate limiting) and secure
    // cookies work behind a load balancer.
    app.set('trust proxy', 1);
  }

  app.use(helmet());
  app.use(
    cors({
      origin: env.WEB_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());

  app.get('/api/v1/health', (_req, res) => {
    const response = healthResponseSchema.parse({
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
    });
    res.status(200).json(response);
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/addresses', addressRouter);
  app.use('/api/v1/bookings', bookingRouter);
  app.use('/api/v1/operations', operationsRouter);
  app.use('/api/v1/operations', operationsTechnicianRouter);
  app.use('/api/v1/technician/availability', technicianAvailabilityRouter);
  app.use('/api/v1/technician/bookings', technicianBookingRouter);
  app.use('/api/v1/technician/profile', technicianProfileRouter);
  app.use('/api/v1', catalogueRouter);
  app.use('/api/v1', publicAvailabilityRouter);
  app.use('/api/v1', pricingRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
