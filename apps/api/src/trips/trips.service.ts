// Business logic. It knows nothing about HTTP (no req/res), so the same rules can be
// reused later by the AI agent's tools, a background job, or a test.
import { badRequest, notFound } from '../errors.js';
import { tripsRepository } from './trips.repository.js';
import type { CreateTripInput, Trip } from './trips.schema.js';

export const tripsService = {
  async create(input: CreateTripInput): Promise<Trip> {
    // Rules that need "now" belong here, not in the schema: the schema only
    // checks shape, the service checks meaning.
    const today = new Date().toISOString().slice(0, 10);
    if (input.departureDate < today) {
      throw badRequest('Request validation failed', [
        { field: 'departureDate', message: 'Departure date cannot be in the past' },
      ]);
    }
    return tripsRepository.create(input);
  },

  async get(id: string): Promise<Trip> {
    const trip = await tripsRepository.findById(id);
    if (!trip) throw notFound('Trip not found');
    return trip;
  },

  list: () => tripsRepository.list(),
};
