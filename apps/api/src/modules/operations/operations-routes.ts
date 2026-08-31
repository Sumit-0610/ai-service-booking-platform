import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/authorize.js';
import { requireCsrf } from '../../middleware/csrf.js';
import { operationsController } from './operations-controller.js';

/**
 * Operations Dashboard (Milestone 10). Authenticated, **operations role only**:
 * unauthenticated -> 401, any other role -> 403. Read-and-triage — the only
 * mutation is a booking status change through the shared state machine, which
 * also requires a CSRF token. Mounted at /api/v1/operations.
 */
export const operationsRouter = Router();

operationsRouter.use(requireAuth, requireRole('operations'));

operationsRouter.get('/dashboard', operationsController.getDashboard);
operationsRouter.get('/bookings', operationsController.listBookings);
operationsRouter.get('/bookings/:id', operationsController.getBooking);
operationsRouter.patch(
  '/bookings/:id/status',
  requireCsrf,
  operationsController.updateBookingStatus,
);
