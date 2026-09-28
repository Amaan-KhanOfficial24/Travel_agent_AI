import { z } from 'zod';

const iata = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Must be a 3-letter IATA airport code');
const isoDate = z.iso.date('Must be a date in YYYY-MM-DD format');

/** What to search for. Either given directly, or derived from a saved trip. */
export const searchCriteriaSchema = z
  .object({
    origin: iata,
    destination: iata,
    departureDate: isoDate,
    returnDate: isoDate.optional(),
    adults: z.number().int().min(1).max(9),
    childAges: z.array(z.number().int().min(0).max(17)).max(8).default([]),
    cabin: z.enum(['economy', 'premium_economy', 'business', 'first']).default('economy'),
    maxConnections: z.number().int().min(0).max(2).optional(),
  })
  .refine((c) => c.origin !== c.destination, { message: 'Origin and destination must differ', path: ['destination'] })
  .refine((c) => !c.returnDate || c.returnDate >= c.departureDate, {
    message: 'Return date cannot be before departure date',
    path: ['returnDate'],
  })
  .refine((c) => c.childAges.filter((a) => a < 2).length <= c.adults, {
    message: 'Each infant needs an adult',
    path: ['childAges'],
  });

export const searchRequestSchema = z.union([
  z.object({ tripId: z.uuid(), maxConnections: z.number().int().min(0).max(2).optional() }),
  z.object({ criteria: searchCriteriaSchema }),
]);

export const offerIdSchema = z.object({ offerId: z.uuid('Offer id must be a UUID') });

export type SearchCriteria = z.infer<typeof searchCriteriaSchema>;
