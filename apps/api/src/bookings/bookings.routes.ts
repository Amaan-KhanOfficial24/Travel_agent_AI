import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { bookingsService } from './bookings.service.js';

const amount = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be an amount like 123.45');
// E.164: + then country code and number, 8 to 15 digits (what airlines require).
const phone = z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Use international format, e.g. +971501234567');

const startSchema = z.object({
  quoteId: z.uuid(),
  confirmedAmount: amount,
  tripId: z.uuid(),
  contact: z.object({ email: z.email(), phone }),
  passengers: z
    .array(z.object({ passengerId: z.uuid(), title: z.enum(['mr', 'ms', 'mrs', 'miss', 'dr']), gender: z.enum(['m', 'f']) }))
    .max(18)
    .default([]),
});
const approveSchema = z.object({ quoteId: z.uuid(), confirmedAmount: amount });
const idSchema = z.object({ id: z.uuid() });

export const bookingsRouter = Router();
bookingsRouter.use(requireAuth);

bookingsRouter.get('/', async (req, res) => res.json({ data: await bookingsService.list(req.user!) }));
bookingsRouter.post('/', validate(startSchema), async (req, res) => {
  res.status(201).json({ data: await bookingsService.start(req.user!, res.locals.body) });
});
bookingsRouter.get('/:id', validate(idSchema, 'params'), async (req, res) => {
  res.json({ data: await bookingsService.get(req.user!, res.locals.params.id) });
});
bookingsRouter.post('/:id/approve', validate(idSchema, 'params'), validate(approveSchema), async (req, res) => {
  res.json({ data: await bookingsService.approve(req.user!, res.locals.params.id, res.locals.body) });
});
bookingsRouter.post('/:id/decline', validate(idSchema, 'params'), async (req, res) => {
  res.json({ data: await bookingsService.decline(req.user!, res.locals.params.id) });
});
bookingsRouter.post('/:id/refresh', validate(idSchema, 'params'), async (req, res) => {
  res.json({ data: await bookingsService.refresh(req.user!, res.locals.params.id) });
});
