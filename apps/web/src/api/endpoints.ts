// One small function per API endpoint, so pages never build URLs or methods by hand.
import { apiFetch } from './client';
import type { NewPassenger, NewTrip, Passenger, Trip, User } from './types';

export const api = {
  me: () => apiFetch<User>('/auth/me'),
  register: (email: string, password: string) => apiFetch<User>('/auth/register', { method: 'POST', body: { email, password } }),
  login: (email: string, password: string) => apiFetch<User>('/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => apiFetch<void>('/auth/logout', { method: 'POST' }),

  listTrips: () => apiFetch<Trip[]>('/trips'),
  getTrip: (id: string) => apiFetch<Trip>(`/trips/${encodeURIComponent(id)}`),
  createTrip: (trip: NewTrip) => apiFetch<Trip>('/trips', { method: 'POST', body: trip }),
  deleteTrip: (id: string) => apiFetch<void>(`/trips/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addPassenger: (tripId: string, p: NewPassenger) =>
    apiFetch<Passenger>(`/trips/${encodeURIComponent(tripId)}/passengers`, { method: 'POST', body: p }),
};
