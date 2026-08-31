import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/authorize.js';
import { requireCsrf } from '../../middleware/csrf.js';
import { loadTechnician } from '../../middleware/load-technician.js';
import { availabilityController } from './availability-controller.js';

/** Public availability browsing. No authentication. Mounted at /api/v1. */
export const publicAvailabilityRouter = Router();
publicAvailabilityRouter.get(
  '/services/:slug/availability',
  availabilityController.publicAvailability,
);

/**
 * Technician self-service availability. Mounted at /api/v1/technician/availability.
 * A technician can only ever touch their own slots — ownership is enforced per
 * row in the repository; state-changing requests also require a CSRF token.
 */
export const technicianAvailabilityRouter = Router();
technicianAvailabilityRouter.use(requireAuth, requireRole('technician'), loadTechnician);
technicianAvailabilityRouter.get('/', availabilityController.listMine);
technicianAvailabilityRouter.post('/', requireCsrf, availabilityController.createMine);
technicianAvailabilityRouter.patch('/:id', requireCsrf, availabilityController.updateMine);
technicianAvailabilityRouter.delete('/:id', requireCsrf, availabilityController.deleteMine);
