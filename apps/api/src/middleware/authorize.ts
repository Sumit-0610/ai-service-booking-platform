import type { Request, RequestHandler } from 'express';
import type { Role } from '@aisbp/shared';
import { AppError } from '../lib/errors.js';

/**
 * Role gate. Reusable by any future route:
 *
 *   router.get('/operations/bookings', requireAuth, requireRole('operations'), handler)
 */
export function requireRole(...roles: [Role, ...Role[]]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new AppError('UNAUTHENTICATED', 'Authentication required'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new AppError('FORBIDDEN', 'You do not have access to this resource'));
      return;
    }
    next();
  };
}

/**
 * Ownership gate for customer-owned resources. `getOwnerId` loads the owning
 * user id for the resource in the request (return `null` if it does not exist).
 * Operations staff may act on any resource. Anyone else may only act on their
 * own; a mismatch returns 404, not 403, so resource existence is not leaked.
 *
 *   router.get('/bookings/:id', requireAuth,
 *     requireResourceOwner((req) => bookingService.getOwnerId(req.params.id)), handler)
 */
export function requireResourceOwner(
  getOwnerId: (req: Request) => Promise<string | null> | string | null,
): RequestHandler {
  return async (req, _res, next) => {
    if (!req.user) {
      next(new AppError('UNAUTHENTICATED', 'Authentication required'));
      return;
    }

    if (req.user.role === 'operations') {
      next();
      return;
    }

    const ownerId = await getOwnerId(req);
    if (!ownerId || ownerId !== req.user.id) {
      next(new AppError('NOT_FOUND', 'Resource not found'));
      return;
    }

    next();
  };
}
