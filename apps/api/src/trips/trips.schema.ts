// The shape of a trip and its passengers, defined once. Zod gives us both runtime
// validation and the TypeScript type, so the two can never drift apart.
import { z } from 'zod';

const iata = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Must be a 3-letter IATA airport code');

const isoDate = z.iso.date('Must be a date in YYYY-MM-DD format');

export const passengerSchema = z.object({
  paxType: z.enum(['adult', 'child', 'infant']),
  title: z.enum(['mr', 'ms', 'mrs', 'miss', 'dr']).optional(),
  givenName: z.string().trim().min(1).max(60),
  familyName: z.string().trim().min(1).max(60),
  bornOn: isoDate,
});

export const createTripSchema = z
  .object({
    origin: iata,
    destination: iata,
    departureDate: isoDate,
    returnDate: isoDate.optional(),
    adults: z.number().int().min(1).max(9),
    children: z.number().int().min(0).max(8).default(0),
    cabin: z.enum(['economy', 'premium_economy', 'business', 'first']).default('economy'),
    // Optional: create the trip and its passengers together, in one transaction.
    passengers: z.array(passengerSchema).max(17).optional(),
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
export type PassengerInput = z.infer<typeof passengerSchema>;

export type Passenger = PassengerInput & { id: string; tripId: string; createdAt: string };

export type Trip = Omit<CreateTripInput, 'passengers'> & {
  id: string;
  userId: string | null;
  createdAt: string;
  passengers?: Passenger[];
};
