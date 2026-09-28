// One small function per API endpoint, so pages never build URLs or methods by hand.
import { apiFetch } from './client';
import type { Booking, BookingSummary, ChatReply, NewPassenger, NewTrip, Offer, Passenger, PriceCheck, Quote, SearchResult, Trip, User } from './types';

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

  searchForTrip: (tripId: string, maxConnections?: number) =>
    apiFetch<SearchResult>('/flights/search', { method: 'POST', body: { tripId, ...(maxConnections !== undefined ? { maxConnections } : {}) } }),
  getOffer: (offerId: string) => apiFetch<Offer>(`/flights/offers/${encodeURIComponent(offerId)}`),
  getQuote: (quoteId: string) => apiFetch<Quote>(`/flights/quotes/${encodeURIComponent(quoteId)}`),
  checkPrice: (offerId: string) => apiFetch<PriceCheck>(`/flights/offers/${encodeURIComponent(offerId)}/quote`, { method: 'POST' }),

  listBookings: () => apiFetch<BookingSummary[]>('/bookings'),
  getBooking: (id: string) => apiFetch<Booking>(`/bookings/${encodeURIComponent(id)}`),
  startBooking: (body: {
    quoteId: string;
    confirmedAmount: string;
    tripId: string;
    contact: { email: string; phone: string };
    passengers: { passengerId: string; title: string; gender: string }[];
  }) => apiFetch<Booking>('/bookings', { method: 'POST', body }),
  approveBooking: (id: string, quoteId: string, confirmedAmount: string) =>
    apiFetch<Booking>(`/bookings/${encodeURIComponent(id)}/approve`, { method: 'POST', body: { quoteId, confirmedAmount } }),
  declineBooking: (id: string) => apiFetch<Booking>(`/bookings/${encodeURIComponent(id)}/decline`, { method: 'POST' }),
  refreshBooking: (id: string) => apiFetch<Booking>(`/bookings/${encodeURIComponent(id)}/refresh`, { method: 'POST' }),

  chat: (message: string, conversationId?: string) =>
    apiFetch<ChatReply>('/agent/chat', { method: 'POST', body: { message, ...(conversationId ? { conversationId } : {}) } }),
};
