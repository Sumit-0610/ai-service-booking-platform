import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/authorize.js';
import { requireCsrf } from '../../middleware/csrf.js';
import { addressController } from './address-controller.js';

/**
 * Authenticated customer address management. Operations and technicians have no
 * access here in this milestone. Ownership is enforced per-row in the
 * repository; state-changing requests also require a CSRF token.
 */
export const addressRouter = Router();

addressRouter.use(requireAuth, requireRole('customer'));

addressRouter.get('/', addressController.list);
addressRouter.post('/', requireCsrf, addressController.create);
addressRouter.get('/:id', addressController.get);
addressRouter.patch('/:id', requireCsrf, addressController.update);
addressRouter.delete('/:id', requireCsrf, addressController.remove);
