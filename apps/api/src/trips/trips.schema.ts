// The shape of a trip, defined once. Zod gives us both runtime validation and the
// TypeScript type, so the two can never drift apart.
import { z } from 'zod';

const iata = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Must be a 3-letter IATA airport code');

const isoDate = z.iso.date('Must be a date in YYYY-MM-DD format');

export const createTripSchema = z
  .object({
    origin: iata,
    destination: iata,
    departureDate: isoDate,
    returnDate: isoDate.optional(),
    adults: z.number().int().min(1).max(9),
    children: z.number().int().min(0).max(8).default(0),
    cabin: z.enum(['economy', 'premium_economy', 'business', 'first']).default('economy'),
  })
  .refine((t) => t.origin !== t.destination, {
    message: 'Origin and destination must differ',
    path: ['destination'],
  })
  .refine((t) => !t.returnDate || t.returnDate >= t.departureDate, {
    message: 'Return date cannot be before departure date',
    path: ['returnDate'],
  });

export const tripIdSchema = z.object({ id: z.uuid('Trip id must be a UUID') });

export type CreateTripInput = z.infer<typeof createTripSchema>;

export type Trip = CreateTripInput & { id: string; createdAt: string };
