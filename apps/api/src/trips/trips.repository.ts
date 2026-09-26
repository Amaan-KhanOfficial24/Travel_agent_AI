// Data access. For Stage 2 trips live in memory (lost on restart). In Stage 3 this
// file is replaced by SQL against PostgreSQL; nothing above it has to change,
// which is the point of keeping storage behind its own layer.
import { randomUUID } from 'node:crypto';
import type { CreateTripInput, Trip } from './trips.schema.js';

const trips = new Map<string, Trip>();

export const tripsRepository = {
  async create(input: CreateTripInput): Promise<Trip> {
    const trip: Trip = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    trips.set(trip.id, trip);
    return trip;
  },

  async findById(id: string): Promise<Trip | undefined> {
    return trips.get(id);
  },

  async list(): Promise<Trip[]> {
    return [...trips.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  // Test helper only.
  async clear(): Promise<void> {
    trips.clear();
  },
};
