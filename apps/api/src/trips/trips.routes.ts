// Routes map a method + path to: validation, then the controller.
import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { tripsController } from './trips.controller.js';
import { createTripSchema, tripIdSchema } from './trips.schema.js';

export const tripsRouter = Router();

tripsRouter.get('/', tripsController.list);
tripsRouter.post('/', validate(createTripSchema), tripsController.create);
tripsRouter.get('/:id', validate(tripIdSchema, 'params'), tripsController.get);
