import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import { offerIdSchema, searchRequestSchema } from './flights.schema.js';
import { flightsService } from './flights.service.js';

export const flightsRouter = Router();
flightsRouter.use(requireAuth);

// POST /flights/search { tripId } or { criteria: {...} }
flightsRouter.post('/search', validate(searchRequestSchema), async (req, res) => {
  res.json({ data: await flightsService.search(req.user!, res.locals.body) });
});

flightsRouter.get('/offers/:offerId', validate(offerIdSchema, 'params'), async (req, res) => {
  res.json({ data: await flightsService.getOffer(req.user!, res.locals.params.offerId) });
});

// "Check price": fresh price from the airline, or alternatives if the fare is gone.
flightsRouter.post('/offers/:offerId/quote', validate(offerIdSchema, 'params'), async (req, res) => {
  res.json({ data: await flightsService.priceOffer(req.user!, res.locals.params.offerId) });
});

flightsRouter.get('/quotes/:quoteId', validate(z.object({ quoteId: z.uuid() }), 'params'), async (req, res) => {
  res.json({ data: await flightsService.getQuote(req.user!, res.locals.params.quoteId) });
});
