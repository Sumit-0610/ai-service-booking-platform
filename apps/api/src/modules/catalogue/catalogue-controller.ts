import type { RequestHandler } from 'express';
import { z } from 'zod';
import { catalogueQuerySchema } from '@aisbp/shared';
import { catalogueService } from './catalogue-service.js';

const slugParamSchema = z.object({
  slug: z.string().min(1).max(200),
});

/** Thin: validate input, call the service, return the response. */

const listCategories: RequestHandler = async (_req, res) => {
  const items = await catalogueService.listCategories();
  res.status(200).json({ items });
};

const listServices: RequestHandler = async (req, res) => {
  const query = catalogueQuerySchema.parse(req.query);
  const result = await catalogueService.listServices(query);
  res.status(200).json(result);
};

const getService: RequestHandler = async (req, res) => {
  const { slug } = slugParamSchema.parse(req.params);
  const service = await catalogueService.getServiceBySlug(slug);
  res.status(200).json({ service });
};

export const catalogueController = { listCategories, listServices, getService };
