import type { Request, RequestHandler } from 'express';
import {
  operationsBookingIdParamSchema,
  operationsBookingsQuerySchema,
  updateBookingStatusSchema,
} from '@aisbp/shared';
import { AppError } from '../../lib/errors.js';
import { operationsService } from './operations-service.js';

/** Thin: validate input, resolve the operator, call the service, return the DTO. */

function operatorId(req: Request): string {
  if (!req.user) {
    throw new AppError('UNAUTHENTICATED', 'Authentication required');
  }
  return req.user.id;
}

const getDashboard: RequestHandler = async (_req, res) => {
  const dashboard = await operationsService.dashboard();
  res.status(200).json({ dashboard });
};

const listBookings: RequestHandler = async (req, res) => {
  const query = operationsBookingsQuerySchema.parse(req.query);
  const result = await operationsService.listBookings(query);
  res.status(200).json(result);
};

const getBooking: RequestHandler = async (req, res) => {
  const { id } = operationsBookingIdParamSchema.parse(req.params);
  const booking = await operationsService.getBooking(id);
  res.status(200).json({ booking });
};

const updateBookingStatus: RequestHandler = async (req, res) => {
  const { id } = operationsBookingIdParamSchema.parse(req.params);
  const input = updateBookingStatusSchema.parse(req.body);
  const booking = await operationsService.changeBookingStatus(operatorId(req), id, input);
  res.status(200).json({ booking });
};

export const operationsController = {
  getDashboard,
  listBookings,
  getBooking,
  updateBookingStatus,
};
