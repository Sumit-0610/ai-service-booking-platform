import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/authorize.js';
import { requireCsrf } from '../../middleware/csrf.js';
import { loadTechnician } from '../../middleware/load-technician.js';
import { bookingController } from './booking-controller.js';

/**
 * Customer booking workflow. Authenticated, customer role only. Every query is
 * scoped to the caller's own id in the repository, so a customer can never
 * reach another customer's booking. Mutations require a CSRF token.
 * Mounted at /api/v1/bookings.
 */
export const bookingRouter = Router();
bookingRouter.use(requireAuth, requireRole('customer'));
bookingRouter.get('/', bookingController.list);
bookingRouter.post('/', requireCsrf, bookingController.create);
bookingRouter.get('/:id', bookingController.get);
bookingRouter.get('/:id/status-history', bookingController.statusHistory);
bookingRouter.post('/:id/cancel', requireCsrf, bookingController.cancel);

/**
 * A technician's own jobs. A booking is linked to a technician either because
 * the customer booked that technician's availability slot (Milestone 9) or
 * because operations assigned them (Milestone 11). The technician may advance
 * their own job through the `technician` transitions
 * (`assigned -> in_progress -> completed`); the mutation requires a CSRF token.
 * Ownership is enforced per row in the repository (`{ id, technicianId }`), so
 * another technician's job is a `404`. Mounted at /api/v1/technician/bookings.
 */
export const technicianBookingRouter = Router();
technicianBookingRouter.use(requireAuth, requireRole('technician'), loadTechnician);
technicianBookingRouter.get('/', bookingController.listMineAsTechnician);
technicianBookingRouter.get('/:id', bookingController.getMineAsTechnician);
technicianBookingRouter.patch(
  '/:id/status',
  requireCsrf,
  bookingController.updateJobStatusAsTechnician,
);
