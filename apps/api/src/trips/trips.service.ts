// Business logic. It knows nothing about HTTP (no req/res), so the same rules can be
// reused later by the AI agent's tools, a background job, or a test.
import { withTransaction } from '../db/pool.js';
import { badRequest, notFound } from '../errors.js';
import { tripsRepository } from './trips.repository.js';
import type { CreateTripInput, Passenger, PassengerInput, Trip } from './trips.schema.js';

const today = () => new Date().toISOString().slice(0, 10);

function checkPassengerMix(trip: Pick<Trip, 'adults' | 'children'>, passengers: PassengerInput[]) {
  const count = (t: PassengerInput['paxType']) => passengers.filter((p) => p.paxType === t).length;
  const problems: { field: string; message: string }[] = [];
  if (count('adult') > trip.adults) problems.push({ field: 'passengers', message: `Trip is for ${trip.adults} adult(s)` });
  if (count('child') > trip.children) problems.push({ field: 'passengers', message: `Trip is for ${trip.children} child(ren)` });
  if (count('infant') > trip.adults) problems.push({ field: 'passengers', message: 'Each infant needs an adult' });
  passengers.forEach((p, i) => {
    if (p.bornOn > today()) problems.push({ field: `passengers.${i}.bornOn`, message: 'Birth date cannot be in the future' });
  });
  if (problems.length) throw badRequest('Request validation failed', problems);
}

export const tripsService = {
  async create(input: CreateTripInput): Promise<Trip> {
    // Rules that need "now" belong here, not in the schema: the schema only
    // checks shape, the service checks meaning.
    if (input.departureDate < today()) {
      throw badRequest('Request validation failed', [
        { field: 'departureDate', message: 'Departure date cannot be in the past' },
      ]);
    }
    const { passengers = [], ...tripInput } = input;
    checkPassengerMix(tripInput, passengers);

    if (passengers.length === 0) return tripsRepository.create(tripInput);

    // Trip and passengers are written in ONE transaction: if any passenger insert
    // fails, the trip insert is rolled back too, so we never keep a half-saved trip.
    return withTransaction(async (tx) => {
      const trip = await tripsRepository.create(tripInput, tx);
      const saved: Passenger[] = [];
      for (const p of passengers) saved.push(await tripsRepository.addPassenger(trip.id, p, tx));
      return { ...trip, passengers: saved };
    });
  },

  async get(id: string): Promise<Trip> {
    const trip = await tripsRepository.findById(id);
    if (!trip) throw notFound('Trip not found');
    return { ...trip, passengers: await tripsRepository.listPassengers(id) };
  },

  list: () => tripsRepository.list(),

  async remove(id: string): Promise<void> {
    if (!(await tripsRepository.delete(id))) throw notFound('Trip not found');
  },

  async addPassenger(tripId: string, p: PassengerInput): Promise<Passenger> {
    // Read the trip and its current passengers, check capacity, then insert, all in
    // one transaction with the trip row locked (FOR UPDATE). Without the lock, two
    // requests at the same moment could both see "1 seat left" and both insert.
    return withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT adults, children FROM trips WHERE id = $1 FOR UPDATE', [tripId]);
      if (!rows[0]) throw notFound('Trip not found');
      const existing = await tripsRepository.listPassengers(tripId, tx);
      checkPassengerMix(rows[0], [...existing, p]);
      return tripsRepository.addPassenger(tripId, p, tx);
    });
  },

  async listPassengers(tripId: string): Promise<Passenger[]> {
    if (!(await tripsRepository.findById(tripId))) throw notFound('Trip not found');
    return tripsRepository.listPassengers(tripId);
  },
};
