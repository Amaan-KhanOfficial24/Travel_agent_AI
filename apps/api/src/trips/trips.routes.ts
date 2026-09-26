// Routes map a method + path to: validation, then the controller.
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { tripsController } from './trips.controller.js';
import { createTripSchema, passengerSchema, tripIdSchema } from './trips.schema.js';

export const tripsRouter = Router();

// Every trips route requires a logged-in user.
tripsRouter.use(requireAuth);

tripsRouter.get('/', tripsController.list);
tripsRouter.post('/', validate(createTripSchema), tripsController.create);
tripsRouter.get('/:id', validate(tripIdSchema, 'params'), tripsController.get);
tripsRouter.delete('/:id', validate(tripIdSchema, 'params'), tripsController.remove);
tripsRouter.get('/:id/passengers', validate(tripIdSchema, 'params'), tripsController.listPassengers);
tripsRouter.post(
  '/:id/passengers',
  validate(tripIdSchema, 'params'),
  validate(passengerSchema),
  tripsController.addPassenger,
);
