import type { Request, RequestHandler } from 'express';
import {
  addTechnicianServiceSchema,
  assignTechnicianSchema,
  bookingIdParamSchema,
  operationsTechniciansQuerySchema,
  setTechnicianStatusSchema,
  technicianIdParamSchema,
  technicianServiceParamSchema,
} from '@aisbp/shared';
import { AppError } from '../../lib/errors.js';
import { technicianService } from './technician-service.js';

/** Thin: validate input, resolve the actor, call the service, return the DTO. */

function operatorId(req: Request): string {
  if (!req.user) {
    throw new AppError('UNAUTHENTICATED', 'Authentication required');
  }
  return req.user.id;
}

function technicianUserId(req: Request): string {
  if (!req.user) {
    throw new AppError('UNAUTHENTICATED', 'Authentication required');
  }
  return req.user.id;
}

// --- operations: technician management ---

const listTechnicians: RequestHandler = async (req, res) => {
  const query = operationsTechniciansQuerySchema.parse(req.query);
  res.status(200).json(await technicianService.list(query));
};

const getTechnician: RequestHandler = async (req, res) => {
  const { id } = technicianIdParamSchema.parse(req.params);
  res.status(200).json({ technician: await technicianService.get(id) });
};

const setTechnicianStatus: RequestHandler = async (req, res) => {
  const { id } = technicianIdParamSchema.parse(req.params);
  const { active } = setTechnicianStatusSchema.parse(req.body);
  res.status(200).json({ technician: await technicianService.setActive(id, active) });
};

const addQualification: RequestHandler = async (req, res) => {
  const { id } = technicianIdParamSchema.parse(req.params);
  const { serviceId } = addTechnicianServiceSchema.parse(req.body);
  res.status(201).json({ technician: await technicianService.addQualification(id, serviceId) });
};

const removeQualification: RequestHandler = async (req, res) => {
  const { id, serviceId } = technicianServiceParamSchema.parse(req.params);
  res.status(200).json({ technician: await technicianService.removeQualification(id, serviceId) });
};

// --- operations: booking assignment ---

const listAssignable: RequestHandler = async (req, res) => {
  const { id } = bookingIdParamSchema.parse(req.params);
  res.status(200).json({ items: await technicianService.assignableForBooking(id) });
};

const assignBooking: RequestHandler = async (req, res) => {
  const { id } = bookingIdParamSchema.parse(req.params);
  const input = assignTechnicianSchema.parse(req.body);
  res
    .status(200)
    .json({ booking: await technicianService.assignBooking(operatorId(req), id, input) });
};

// --- technician: own profile ---

const getProfile: RequestHandler = async (req, res) => {
  res.status(200).json({ profile: await technicianService.profileForUser(technicianUserId(req)) });
};

export const technicianController = {
  listTechnicians,
  getTechnician,
  setTechnicianStatus,
  addQualification,
  removeQualification,
  listAssignable,
  assignBooking,
  getProfile,
};
