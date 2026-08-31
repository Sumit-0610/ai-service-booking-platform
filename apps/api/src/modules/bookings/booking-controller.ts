import type { Request, RequestHandler } from 'express';
import {
  bookingIdParamSchema,
  createBookingSchema,
  technicianJobStatusSchema,
} from '@aisbp/shared';
import { AppError } from '../../lib/errors.js';
import { bookingService } from './booking-service.js';

/** Thin: validate input, resolve the caller, call the service, return the DTO. */

function customerId(req: Request): string {
  if (!req.user) {
    throw new AppError('UNAUTHENTICATED', 'Authentication required');
  }
  return req.user.id;
}

function technicianId(req: Request): string {
  if (!req.technician) {
    throw new AppError('FORBIDDEN', 'This account has no technician profile');
  }
  return req.technician.id;
}

function technicianUserId(req: Request): string {
  if (!req.user) {
    throw new AppError('UNAUTHENTICATED', 'Authentication required');
  }
  return req.user.id;
}

const create: RequestHandler = async (req, res) => {
  const input = createBookingSchema.parse(req.body);
  const booking = await bookingService.createForCustomer(customerId(req), input);
  res.status(201).json({ booking });
};

const list: RequestHandler = async (req, res) => {
  const items = await bookingService.listForCustomer(customerId(req));
  res.status(200).json({ items });
};

const get: RequestHandler = async (req, res) => {
  const { id } = bookingIdParamSchema.parse(req.params);
  const booking = await bookingService.getForCustomer(customerId(req), id);
  res.status(200).json({ booking });
};

const statusHistory: RequestHandler = async (req, res) => {
  const { id } = bookingIdParamSchema.parse(req.params);
  const items = await bookingService.statusHistoryForCustomer(customerId(req), id);
  res.status(200).json({ items });
};

const cancel: RequestHandler = async (req, res) => {
  const { id } = bookingIdParamSchema.parse(req.params);
  const booking = await bookingService.cancelForCustomer(customerId(req), id);
  res.status(200).json({ booking });
};

const listMineAsTechnician: RequestHandler = async (req, res) => {
  const items = await bookingService.listForTechnician(technicianId(req));
  res.status(200).json({ items });
};

const getMineAsTechnician: RequestHandler = async (req, res) => {
  const { id } = bookingIdParamSchema.parse(req.params);
  const booking = await bookingService.getForTechnician(technicianId(req), id);
  res.status(200).json({ booking });
};

const updateJobStatusAsTechnician: RequestHandler = async (req, res) => {
  const { id } = bookingIdParamSchema.parse(req.params);
  const { status } = technicianJobStatusSchema.parse(req.body);
  const booking = await bookingService.changeJobStatusForTechnician(
    technicianId(req),
    technicianUserId(req),
    id,
    status,
  );
  res.status(200).json({ booking });
};

export const bookingController = {
  create,
  list,
  get,
  statusHistory,
  cancel,
  listMineAsTechnician,
  getMineAsTechnician,
  updateJobStatusAsTechnician,
};
