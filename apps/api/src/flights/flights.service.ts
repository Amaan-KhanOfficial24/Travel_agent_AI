// Flight search and offer pricing. Everything here is deterministic backend logic:
// the AI agent and the web pages both call these same functions.
import type { SessionUser } from '../auth/sessions.js';
import { pool } from '../db/pool.js';
import { AppError, badRequest, notFound } from '../errors.js';
import { toMinor } from '../money.js';
import { duffel, type SearchPassenger } from '../providers/duffel/client.js';
import { normalizeOffer, type FlightOffer } from '../providers/duffel/normalize.js';
import type { DuffelOffer } from '../providers/duffel/types.js';
import { tripsService } from '../trips/trips.service.js';
import type { SearchCriteria } from './flights.schema.js';

export type StoredOffer = FlightOffer & { id: string; searchId: string };

const MAX_RESULTS = 20;

function ageOn(bornOn: string, onDate: string): number {
  const [by, bm, bd] = bornOn.split('-').map(Number) as [number, number, number];
  const [y, m, d] = onDate.split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** Build search criteria from a saved trip; child ages come from its passengers. */
async function criteriaFromTrip(actor: SessionUser, tripId: string, maxConnections?: number): Promise<SearchCriteria> {
  const trip = await tripsService.get(actor, tripId);
  const minors = (trip.passengers ?? []).filter((p) => p.paxType !== 'adult');
  if (minors.length < trip.children) {
    throw badRequest('Request validation failed', [
      { field: 'tripId', message: `Add the ${trip.children} child passenger(s) first, so their ages are known` },
    ]);
  }
  return {
    origin: trip.origin,
    destination: trip.destination,
    departureDate: trip.departureDate,
    ...(trip.returnDate ? { returnDate: trip.returnDate } : {}),
    adults: trip.adults,
    childAges: minors.map((p) => ageOn(p.bornOn, trip.departureDate)),
    cabin: trip.cabin,
    ...(maxConnections !== undefined ? { maxConnections } : {}),
  };
}

async function storeOffers(actor: SessionUser, searchId: string, offers: DuffelOffer[]): Promise<StoredOffer[]> {
  const result: StoredOffer[] = [];
  for (const raw of offers) {
    const o = normalizeOffer(raw);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO offers (search_id, user_id, provider_offer_id, itinerary_key, total_amount, currency, expires_at, summary, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (provider, provider_offer_id)
         DO UPDATE SET total_amount = EXCLUDED.total_amount, summary = EXCLUDED.summary, raw = EXCLUDED.raw, expires_at = EXCLUDED.expires_at
       RETURNING id`,
      [searchId, actor.id, o.providerOfferId, o.itineraryKey, o.totalAmount, o.currency, o.expiresAt, o, raw],
    );
    result.push({ ...o, id: rows[0]!.id, searchId });
  }
  return result;
}

export const flightsService = {
  criteriaFromTrip,

  async search(actor: SessionUser, input: { tripId?: string; criteria?: SearchCriteria; maxConnections?: number }) {
    const criteria = input.tripId ? await criteriaFromTrip(actor, input.tripId, input.maxConnections) : input.criteria!;
    const today = new Date().toISOString().slice(0, 10);
    if (criteria.departureDate < today) {
      throw badRequest('Request validation failed', [{ field: 'departureDate', message: 'Departure date cannot be in the past' }]);
    }

    const passengers: SearchPassenger[] = [
      ...Array.from({ length: criteria.adults }, () => ({ type: 'adult' as const })),
      ...criteria.childAges.map((age) => ({ age })),
    ];
    const slices = [{ origin: criteria.origin, destination: criteria.destination, departure_date: criteria.departureDate }];
    if (criteria.returnDate) slices.push({ origin: criteria.destination, destination: criteria.origin, departure_date: criteria.returnDate });

    const request = await duffel.searchOffers({
      slices,
      passengers,
      cabin_class: criteria.cabin,
      ...(criteria.maxConnections !== undefined ? { max_connections: criteria.maxConnections } : {}),
    });

    // Cheapest first, keep the top results (Duffel can return hundreds).
    const sorted = [...request.offers].sort((a, b) => toMinor(a.total_amount) - toMinor(b.total_amount)).slice(0, MAX_RESULTS);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO flight_searches (user_id, trip_id, criteria, provider_request_id, offer_count)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [actor.id, input.tripId ?? null, criteria, request.id || null, request.offers.length],
    );
    const searchId = rows[0]!.id;
    const offers = await storeOffers(actor, searchId, sorted);
    return { searchId, criteria, totalFound: request.offers.length, offers };
  },

  /** Re-run a stored search (used by fare-change recovery). */
  async researchFor(actor: SessionUser, searchId: string) {
    const { rows } = await pool.query<{ criteria: SearchCriteria; trip_id: string | null }>(
      'SELECT criteria, trip_id FROM flight_searches WHERE id = $1 AND user_id = $2',
      [searchId, actor.id],
    );
    if (!rows[0]) throw notFound('Search not found');
    const request = await duffel.searchOffers({
      slices: [
        { origin: rows[0].criteria.origin, destination: rows[0].criteria.destination, departure_date: rows[0].criteria.departureDate },
        ...(rows[0].criteria.returnDate
          ? [{ origin: rows[0].criteria.destination, destination: rows[0].criteria.origin, departure_date: rows[0].criteria.returnDate }]
          : []),
      ],
      passengers: [
        ...Array.from({ length: rows[0].criteria.adults }, () => ({ type: 'adult' as const })),
        ...rows[0].criteria.childAges.map((age) => ({ age })),
      ],
      cabin_class: rows[0].criteria.cabin,
    });
    return storeOffers(actor, searchId, request.offers);
  },

  async getOffer(actor: SessionUser, offerId: string): Promise<StoredOffer> {
    const { rows } = await pool.query<{ id: string; search_id: string; summary: FlightOffer }>(
      'SELECT id, search_id, summary FROM offers WHERE id = $1 AND user_id = $2',
      [offerId, actor.id],
    );
    if (!rows[0]) throw notFound('Offer not found');
    return { ...rows[0].summary, id: rows[0].id, searchId: rows[0].search_id };
  },

  /**
   * Ask Duffel for the offer's CURRENT state: search prices can be stale by the time the
   * customer decides. Returns the fresh offer (stored under the same id) or null if gone.
   */
  async refreshOffer(actor: SessionUser, offerId: string): Promise<StoredOffer | null> {
    const stored = await flightsService.getOffer(actor, offerId);
    const fresh = await duffel.getOffer(stored.providerOfferId);
    if (!fresh) return null;
    const [updated] = await storeOffers(actor, stored.searchId, [fresh]);
    return updated!;
  },

  async createQuote(
    actor: SessionUser,
    offer: StoredOffer,
    opts: { referenceAmount: string; status: 'SAME_PRICE' | 'PRICE_CHANGED' | 'ALTERNATIVE'; matchTier?: string; bookingId?: string },
  ) {
    const { rows } = await pool.query<{ id: string; created_at: Date }>(
      `INSERT INTO quotes (user_id, offer_id, booking_id, status, match_tier, reference_amount, total_amount, currency, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, created_at`,
      [actor.id, offer.id, opts.bookingId ?? null, opts.status, opts.matchTier ?? 'EXACT', opts.referenceAmount, offer.totalAmount, offer.currency, offer.expiresAt],
    );
    return toQuote(rows[0]!.id, offer, opts.referenceAmount, opts.status, opts.matchTier ?? 'EXACT');
  },

  /**
   * "Check price": refresh the offer and produce a quote the customer can agree to.
   * If the offer is gone, re-shop and return the closest alternatives instead.
   */
  async priceOffer(actor: SessionUser, offerId: string) {
    const original = await flightsService.getOffer(actor, offerId);
    const fresh = await flightsService.refreshOffer(actor, offerId);
    if (fresh) {
      const status = toMinor(fresh.totalAmount) === toMinor(original.totalAmount) ? 'SAME_PRICE' : 'PRICE_CHANGED';
      return { available: true as const, quote: await flightsService.createQuote(actor, fresh, { referenceAmount: original.totalAmount, status }) };
    }
    const { findAlternatives } = await import('../bookings/matching.js');
    const candidates = await flightsService.researchFor(actor, original.searchId);
    const alternatives = [];
    for (const m of findAlternatives(original, candidates).slice(0, 3)) {
      alternatives.push(await flightsService.createQuote(actor, m.offer, { referenceAmount: original.totalAmount, status: 'ALTERNATIVE', matchTier: m.tier }));
    }
    return { available: false as const, alternatives };
  },

  async getQuote(actor: SessionUser, quoteId: string) {
    const { rows } = await pool.query<{
      id: string; status: 'SAME_PRICE' | 'PRICE_CHANGED' | 'ALTERNATIVE'; match_tier: string; reference_amount: string;
      offer_id: string; expires_at: Date;
    }>('SELECT id, status, match_tier, reference_amount, offer_id, expires_at FROM quotes WHERE id = $1 AND user_id = $2', [quoteId, actor.id]);
    const q = rows[0];
    if (!q) throw notFound('Quote not found');
    const offer = await flightsService.getOffer(actor, q.offer_id);
    return toQuote(q.id, offer, q.reference_amount, q.status, q.match_tier);
  },
};

export type Quote = ReturnType<typeof toQuote>;

function toQuote(id: string, offer: StoredOffer, referenceAmount: string, status: string, matchTier: string) {
  const diff = toMinor(offer.totalAmount) - toMinor(referenceAmount);
  return {
    id,
    status,
    matchTier,
    offer,
    referenceAmount,
    totalAmount: offer.totalAmount,
    currency: offer.currency,
    difference: (diff < 0 ? '-' : '') + (Math.abs(diff) / 100).toFixed(2),
    expiresAt: offer.expiresAt,
  };
}

/** Provider errors become HTTP errors with messages a customer can act on. */
export function providerErrorToAppError(err: { category: string; message: string; code?: string }): AppError {
  switch (err.category) {
    case 'NOT_CONFIGURED':
      return new AppError(503, 'FEATURE_NOT_CONFIGURED', 'Flight search is not set up yet (DUFFEL_ACCESS_TOKEN is missing).');
    case 'AUTH':
      return new AppError(502, 'PROVIDER_AUTH_FAILED', 'The flight provider rejected our credentials. Check DUFFEL_ACCESS_TOKEN.');
    case 'RATE_LIMITED':
      return new AppError(503, 'PROVIDER_BUSY', 'The flight provider is busy. Please try again in a minute.');
    case 'TIMEOUT':
      return new AppError(504, 'PROVIDER_TIMEOUT', 'The airline took too long to respond. Please try again.');
    case 'OFFER_UNAVAILABLE':
      return new AppError(409, 'OFFER_UNAVAILABLE', 'This fare is no longer available.');
    case 'INVALID_REQUEST':
      return new AppError(422, 'PROVIDER_REJECTED', err.message);
    case 'FUNDING':
      return new AppError(503, 'PROVIDER_FUNDING', 'Bookings are temporarily unavailable. Our team has been alerted.');
    default:
      return new AppError(503, 'PROVIDER_UNAVAILABLE', 'The flight provider is temporarily unavailable. Please try again.');
  }
}
