import type { RequestHandler } from 'express';
import { repositories } from '@aisbp/database';
import { AppError } from '../lib/errors.js';

/**
 * Resolves the technician profile for the authenticated user and attaches
 * `req.technician`. Runs after `requireAuth` + `requireRole('technician')`.
 * A `technician`-role account with no profile row is a data inconsistency and is
 * rejected rather than allowed through.
 */
export const loadTechnician: RequestHandler = async (req, _res, next) => {
  if (!req.user) {
    next(new AppError('UNAUTHENTICATED', 'Authentication required'));
    return;
  }

  const technician = await repositories.technicians.findByUserId(req.user.id);
  if (!technician) {
    next(new AppError('FORBIDDEN', 'This account has no technician profile'));
    return;
  }

  req.technician = { id: technician.id, active: technician.active };
  next();
};
