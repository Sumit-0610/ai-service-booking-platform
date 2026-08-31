import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/authorize.js';
import { requireCsrf } from '../../middleware/csrf.js';
import { loadTechnician } from '../../middleware/load-technician.js';
import { technicianController } from './technician-controller.js';

/**
 * Operations technician management and booking assignment (Milestone 11).
 * Authenticated, **operations role only**. Mutations require a CSRF token.
 * Mounted at /api/v1/operations, alongside the operations dashboard router.
 */
export const operationsTechnicianRouter = Router();
operationsTechnicianRouter.use(requireAuth, requireRole('operations'));

operationsTechnicianRouter.get('/technicians', technicianController.listTechnicians);
operationsTechnicianRouter.get('/technicians/:id', technicianController.getTechnician);
operationsTechnicianRouter.patch(
  '/technicians/:id/status',
  requireCsrf,
  technicianController.setTechnicianStatus,
);
operationsTechnicianRouter.post(
  '/technicians/:id/services',
  requireCsrf,
  technicianController.addQualification,
);
operationsTechnicianRouter.delete(
  '/technicians/:id/services/:serviceId',
  requireCsrf,
  technicianController.removeQualification,
);

operationsTechnicianRouter.get(
  '/bookings/:id/assignable-technicians',
  technicianController.listAssignable,
);
operationsTechnicianRouter.post(
  '/bookings/:id/assign-technician',
  requireCsrf,
  technicianController.assignBooking,
);

/**
 * A technician's own read-only profile. Mounted at /api/v1/technician/profile.
 */
export const technicianProfileRouter = Router();
technicianProfileRouter.use(requireAuth, requireRole('technician'), loadTechnician);
technicianProfileRouter.get('/', technicianController.getProfile);
