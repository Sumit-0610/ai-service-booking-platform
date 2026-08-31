import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import {
  availabilityWindowQuerySchema,
  createSlotSchema,
  resourceIdParamSchema,
  updateSlotSchema,
} from '@aisbp/shared';
import { AppError } from '../../lib/errors.js';
import { availabilityService } from './availability-service.js';

const slugParamSchema = z.object({ slug: z.string().min(1).max(200) });

function technicianId(req: Request): string {
  if (!req.technician) {
    throw new AppError('FORBIDDEN', 'This account has no technician profile');
  }
  return req.technician.id;
}

/** Public: browse availability for an active service. No authentication. */
const publicAvailability: RequestHandler = async (req, res) => {
  const { slug } = slugParamSchema.parse(req.params);
  const query = availabilityWindowQuerySchema.parse(req.query);
  const result = await availabilityService.publicForService(slug, query);
  res.status(200).json(result);
};

/** Technician: manage own availability. */
const listMine: RequestHandler = async (req, res) => {
  const items = await availabilityService.listForTechnician(technicianId(req));
  res.status(200).json({ items });
};

const createMine: RequestHandler = async (req, res) => {
  const input = createSlotSchema.parse(req.body);
  const slot = await availabilityService.createForTechnician(technicianId(req), input);
  res.status(201).json({ slot });
};

const updateMine: RequestHandler = async (req, res) => {
  const { id } = resourceIdParamSchema.parse(req.params);
  const input = updateSlotSchema.parse(req.body);
  const slot = await availabilityService.updateForTechnician(technicianId(req), id, input);
  res.status(200).json({ slot });
};

const deleteMine: RequestHandler = async (req, res) => {
  const { id } = resourceIdParamSchema.parse(req.params);
  await availabilityService.removeForTechnician(technicianId(req), id);
  res.status(204).end();
};

export const availabilityController = {
  publicAvailability,
  listMine,
  createMine,
  updateMine,
  deleteMine,
};
