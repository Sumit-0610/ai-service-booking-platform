import type { Request, RequestHandler } from 'express';
import { addressIdParamSchema, createAddressSchema, updateAddressSchema } from '@aisbp/shared';
import { AppError } from '../../lib/errors.js';
import { addressService } from './address-service.js';

/** Thin: resolve the owner, validate input, call the service, shape the response. */

function ownerId(req: Request): string {
  if (!req.user) {
    throw new AppError('UNAUTHENTICATED', 'Authentication required');
  }
  return req.user.id;
}

const list: RequestHandler = async (req, res) => {
  const items = await addressService.list(ownerId(req));
  res.status(200).json({ items });
};

const create: RequestHandler = async (req, res) => {
  const input = createAddressSchema.parse(req.body);
  const address = await addressService.create(ownerId(req), input);
  res.status(201).json({ address });
};

const get: RequestHandler = async (req, res) => {
  const { id } = addressIdParamSchema.parse(req.params);
  const address = await addressService.get(ownerId(req), id);
  res.status(200).json({ address });
};

const update: RequestHandler = async (req, res) => {
  const { id } = addressIdParamSchema.parse(req.params);
  const input = updateAddressSchema.parse(req.body);
  const address = await addressService.update(ownerId(req), id, input);
  res.status(200).json({ address });
};

const remove: RequestHandler = async (req, res) => {
  const { id } = addressIdParamSchema.parse(req.params);
  await addressService.remove(ownerId(req), id);
  res.status(204).end();
};

export const addressController = { list, create, get, update, remove };
