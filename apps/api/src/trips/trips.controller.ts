// Controllers translate between HTTP and the service: read validated input from the
// request, call the service, choose the status code, send JSON. No business rules here.
import type { Request, Response } from 'express';
import { tripsService } from './trips.service.js';

export const tripsController = {
  async create(_req: Request, res: Response) {
    const trip = await tripsService.create(res.locals.body);
    res.status(201).location(`/trips/${trip.id}`).json({ data: trip });
  },

  async get(_req: Request, res: Response) {
    const trip = await tripsService.get(res.locals.params.id);
    res.json({ data: trip });
  },

  async list(_req: Request, res: Response) {
    res.json({ data: await tripsService.list() });
  },
};
