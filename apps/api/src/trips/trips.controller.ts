// Controllers translate between HTTP and the service: read validated input and the
// logged-in user from the request, call the service, choose the status code, send JSON.
// requireAuth runs before every trips route, so req.user is always set here.
import type { Request, Response } from 'express';
import { tripsService } from './trips.service.js';

export const tripsController = {
  async create(req: Request, res: Response) {
    const trip = await tripsService.create(req.user!, res.locals.body);
    res.status(201).location(`/trips/${trip.id}`).json({ data: trip });
  },

  async get(req: Request, res: Response) {
    res.json({ data: await tripsService.get(req.user!, res.locals.params.id) });
  },

  async list(req: Request, res: Response) {
    res.json({ data: await tripsService.list(req.user!) });
  },

  async remove(req: Request, res: Response) {
    await tripsService.remove(req.user!, res.locals.params.id);
    res.status(204).end();
  },

  async addPassenger(req: Request, res: Response) {
    const passenger = await tripsService.addPassenger(req.user!, res.locals.params.id, res.locals.body);
    res.status(201).json({ data: passenger });
  },

  async listPassengers(req: Request, res: Response) {
    res.json({ data: await tripsService.listPassengers(req.user!, res.locals.params.id) });
  },
};
