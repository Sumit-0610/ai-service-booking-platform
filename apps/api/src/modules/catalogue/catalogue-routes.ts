import { Router } from 'express';
import { catalogueController } from './catalogue-controller.js';

/**
 * Public catalogue. No authentication — anyone can browse active services.
 */
export const catalogueRouter = Router();

catalogueRouter.get('/categories', catalogueController.listCategories);
catalogueRouter.get('/services', catalogueController.listServices);
catalogueRouter.get('/services/:slug', catalogueController.getService);
