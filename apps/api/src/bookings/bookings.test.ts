// Flight search, pricing, booking and fare-change recovery, end to end through the API,
// against the stand-in Duffel server (same HTTP format and scenario routes as Duffel test mode).
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { signUp } from '../test/auth.js';
import { resetDb } from '../test/db.js';

const app = createApp();
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
type Agent = Awaited<ReturnType<typeof signUp>>['agent'];
let user: Agent;

beforeEach(async () => {
  await resetDb();
  user = (await signUp(app)).agent;
});
afterAll(() => pool.end());

const contact = { email: 'aman@example.com', phone: '+971501234567' };

/** Create a trip with passengers, search it, check the cheapest price. */
async function tripAndQuote(origin: string, destination: string, opts: { adults?: number; child?: boolean } = {}) {
  const adults = opts.adults ?? 1;
  const passengers = [
    ...Array.from({ length: adults }, (_, i) => ({ paxType: 'adult', title: 'mr', gender: 'm', givenName: `Adult${String.fromCharCode(65 + i)}`, familyName: 'Khan', bornOn: '1990-01-01' })),
    ...(opts.child ? [{ paxType: 'child', givenName: 'Sara', familyName: 'Khan', bornOn: '2018-06-01' }] : []),
  ];
  const trip = await user.post('/trips').send({ origin, destination, departureDate: future(40), adults, children: opts.child ? 1 : 0, passengers });
  expect(trip.status).toBe(201);
  const search = await user.post('/flights/search').send({ tripId: trip.body.data.id });
  expect(search.status).toBe(200);
  const offer = search.body.data.offers[0];
  const priced = await user.post(`/flights/offers/${offer.id}/quote`);
  expect(priced.status).toBe(200);
  return { trip: trip.body.data, search: search.body.data, offer, priced: priced.body.data };
}

async function book(tripId: string, quote: { id: string; totalAmount: string }, passengers: unknown[] = []) {
  return user.post('/bookings').send({ quoteId: quote.id, confirmedAmount: quote.totalAmount, tripId, contact, passengers });
}

describe('flight search', () => {
  it('returns normalized offers, cheapest first, and stores them', async () => {
    const res = await user.post('/flights/search').send({ criteria: { origin: 'dxb', destination: 'LHR', departureDate: future(30), adults: 2 } });
    expect(res.status).toBe(200);
    const offers = res.body.data.offers;
    expect(offers).toHaveLength(3);
    expect(Number(offers[0].totalAmount)).toBeLessThanOrEqual(Number(offers[1].totalAmount));
    expect(offers[0]).toMatchObject({ currency: 'USD', owner: { code: 'ZZ' }, slices: [{ origin: 'DXB', destination: 'LHR' }] });
    expect(offers[0].passengers).toHaveLength(2);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM offers');
    expect(rows[0].n).toBe(3);
  });

  it('nonstop filter removes connecting flights', async () => {
    const res = await user.post('/flights/search').send({ criteria: { origin: 'DXB', destination: 'LHR', departureDate: future(30), adults: 1, maxConnections: 0 } });
    expect(res.body.data.offers.every((o: { slices: { stops: number }[] }) => o.slices.every((s) => s.stops === 0))).toBe(true);
  });

  it('empty result on the no-flights route (PVD → RAI)', async () => {
    const res = await user.post('/flights/search').send({ criteria: { origin: 'PVD', destination: 'RAI', departureDate: future(30), adults: 1 } });
    expect(res.status).toBe(200);
    expect(res.body.data.offers).toEqual([]);
  });

  it('airline timeout becomes a clear 504', async () => {
    const res = await user.post('/flights/search').send({ criteria: { origin: 'STN', destination: 'LHR', departureDate: future(30), adults: 1 } });
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('PROVIDER_TIMEOUT');
  });

  it('a trip with children needs the child passengers first (their ages)', async () => {
    const trip = await user.post('/trips').send({ origin: 'DXB', destination: 'LHR', departureDate: future(30), adults: 1, children: 1 });
    const res = await user.post('/flights/search').send({ tripId: trip.body.data.id });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toMatch(/child passenger/);
  });

  it("offers are private: another user's offer is 404", async () => {
    const res = await user.post('/flights/search').send({ criteria: { origin: 'DXB', destination: 'LHR', departureDate: future(30), adults: 1 } });
    const other = (await signUp(app)).agent;
    expect((await other.get(`/flights/offers/${res.body.data.offers[0].id}`)).status).toBe(404);
  });
});

describe('check price', () => {
  it('same price', async () => {
    const { priced } = await tripAndQuote('DXB', 'LHR');
    expect(priced.available).toBe(true);
    expect(priced.quote).toMatchObject({ status: 'SAME_PRICE', difference: '0.00' });
  });

  it('price changed (LHR → STN): shows old price, new price and the difference', async () => {
    const { offer, priced } = await tripAndQuote('LHR', 'STN');
    expect(priced.quote.status).toBe('PRICE_CHANGED');
    expect(priced.quote.referenceAmount).toBe(offer.totalAmount);
    const diff = Number(priced.quote.totalAmount) - Number(offer.totalAmount);
    expect(Number(priced.quote.difference)).toBeCloseTo(diff, 2);
    expect(diff).toBeGreaterThan(0);
  });

  it('fare gone (LGW → LHR): alternatives instead', async () => {
    const { priced } = await tripAndQuote('LGW', 'LHR');
    expect(priced.available).toBe(false);
    expect(priced.alternatives.length).toBeGreaterThan(0);
    expect(priced.alternatives[0].status).toBe('ALTERNATIVE');
  });
});

describe('booking', () => {
  it('happy path: 2 adults + 1 child are ticketed, with an audit trail', async () => {
    const { trip, priced } = await tripAndQuote('DXB', 'LHR', { adults: 2, child: true });
    const child = trip.passengers.find((p: { paxType: string }) => p.paxType === 'child');
    const res = await book(trip.id, priced.quote, [{ passengerId: child.id, title: 'miss', gender: 'f' }]);
    expect(res.status).toBe(201);
    const b = res.body.data;
    expect(b.state).toBe('TICKETED');
    expect(b.pnr).toMatch(/^[A-Z0-9]{6}$/);
    expect(b.tickets).toHaveLength(3);
    expect(b.paidAmount).toBe(priced.quote.totalAmount);
    expect(b.events.map((e: { event: string }) => e.event)).toEqual(['BOOKING_STARTED', 'REPRICED', 'ORDER_SENT', 'ORDER_CONFIRMED']);
  });

  it('refuses when the confirmed amount is not the quoted price (consent)', async () => {
    const { trip, priced } = await tripAndQuote('DXB', 'LHR');
    const res = await user.post('/bookings').send({ quoteId: priced.quote.id, confirmedAmount: '1.00', tripId: trip.id, contact });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONSENT_MISMATCH');
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM bookings');
    expect(rows[0].n).toBe(0);
  });

  it('asks for title and gender when missing, before contacting the airline', async () => {
    const { trip, priced } = await tripAndQuote('DXB', 'LHR', { child: true });
    const res = await book(trip.id, priced.quote);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toMatch(/Title and gender are required for Sara Khan/);
  });

  it('rejects a phone number not in international format', async () => {
    const { trip, priced } = await tripAndQuote('DXB', 'LHR');
    const res = await user.post('/bookings').send({ quoteId: priced.quote.id, confirmedAmount: priced.quote.totalAmount, tripId: trip.id, contact: { ...contact, phone: '0501234567' } });
    expect(res.status).toBe(400);
  });

  it('cannot book the same trip twice', async () => {
    const { trip, priced } = await tripAndQuote('DXB', 'LHR');
    expect((await book(trip.id, priced.quote)).body.data.state).toBe('TICKETED');
    const again = await user.post(`/flights/offers/${priced.quote.offer.id}/quote`);
    const res = await book(trip.id, again.body.data.quote ?? priced.quote);
    expect(res.status).toBe(409);
  });

  it("another user cannot see the booking", async () => {
    const { trip, priced } = await tripAndQuote('DXB', 'LHR');
    const id = (await book(trip.id, priced.quote)).body.data.id;
    const other = (await signUp(app)).agent;
    expect((await other.get(`/bookings/${id}`)).status).toBe(404);
  });
});

describe('fare-change recovery', () => {
  it('price rises after the customer agreed → approval with the difference → approve → ticketed', async () => {
    const { trip, priced } = await tripAndQuote('LHR', 'GLA'); // stand-in route: +10% on the 2nd refresh
    const first = (await book(trip.id, priced.quote)).body.data;
    expect(first.state).toBe('AWAITING_APPROVAL');
    const pending = first.pendingApproval;
    expect(pending.quote.matchTier).toBe('EXACT');
    expect(Number(pending.quote.totalAmount)).toBeCloseTo(Number(priced.quote.totalAmount) * 1.1, 1);
    expect(Number(pending.difference)).toBeGreaterThan(0);

    const wrong = await user.post(`/bookings/${first.id}/approve`).send({ quoteId: pending.quote.id, confirmedAmount: priced.quote.totalAmount });
    expect(wrong.status).toBe(409); // agreeing to the OLD price does not count

    const ok = await user.post(`/bookings/${first.id}/approve`).send({ quoteId: pending.quote.id, confirmedAmount: pending.quote.totalAmount });
    expect(ok.status).toBe(200);
    expect(ok.body.data.state).toBe('TICKETED');
    expect(ok.body.data.paidAmount).toBe(pending.quote.totalAmount);
    expect(ok.body.data.attemptCount).toBe(2);
    expect(ok.body.data.events.map((e: { event: string }) => e.event)).toEqual(
      expect.arrayContaining(['RECOVERY_STARTED', 'APPROVAL_REQUESTED', 'CUSTOMER_APPROVED', 'ORDER_CONFIRMED']),
    );
  });

  it('order rejected with price_changed → re-search → same flights offered → approve → ticketed', async () => {
    const { trip, priced } = await tripAndQuote('LHR', 'EDI'); // stand-in: first order fails
    const first = (await book(trip.id, priced.quote)).body.data;
    expect(first.state).toBe('AWAITING_APPROVAL');
    expect(first.events.map((e: { event: string }) => e.event)).toContain('RECOVERY_SEARCH');
    const q = first.pendingApproval.quote;
    const ok = await user.post(`/bookings/${first.id}/approve`).send({ quoteId: q.id, confirmedAmount: q.totalAmount });
    expect(ok.body.data.state).toBe('TICKETED');
  });

  it('declining the new price cancels, nothing booked', async () => {
    const { trip, priced } = await tripAndQuote('LHR', 'GLA');
    const first = (await book(trip.id, priced.quote)).body.data;
    const res = await user.post(`/bookings/${first.id}/decline`);
    expect(res.body.data.state).toBe('CANCELLED');
    expect(res.body.data.pnr).toBeNull();
  });

  it('stops after the maximum attempts instead of looping forever', async () => {
    const { trip, priced } = await tripAndQuote('LHR', 'BHX'); // stand-in: every order fails
    let b = (await book(trip.id, priced.quote)).body.data;
    let guard = 0;
    while (b.state === 'AWAITING_APPROVAL' && guard++ < 10) {
      const q = b.pendingApproval.quote;
      b = (await user.post(`/bookings/${b.id}/approve`).send({ quoteId: q.id, confirmedAmount: q.totalAmount })).body.data;
    }
    expect(b.state).toBe('FAILED');
    expect(b.attemptCount).toBe(3);
    expect(b.failureReason).toMatch(/tried 3 times/);
  });

  it('refuses an increase above the limit (40% > 25%)', async () => {
    const { trip, priced } = await tripAndQuote('LHR', 'MAN');
    const b = (await book(trip.id, priced.quote)).body.data;
    expect(b.state).toBe('FAILED');
    expect(b.failureReason).toMatch(/over our 25% limit/);
  });

  it('two approvals at once: exactly one proceeds', async () => {
    const { trip, priced } = await tripAndQuote('LHR', 'GLA');
    const first = (await book(trip.id, priced.quote)).body.data;
    const q = first.pendingApproval.quote;
    const [a, b] = await Promise.all([
      user.post(`/bookings/${first.id}/approve`).send({ quoteId: q.id, confirmedAmount: q.totalAmount }),
      user.post(`/bookings/${first.id}/approve`).send({ quoteId: q.id, confirmedAmount: q.totalAmount }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM booking_events WHERE event = 'ORDER_CONFIRMED'");
    expect(rows[0].n).toBe(1);
  });
});

describe('uncertain and failed orders', () => {
  it('202 accepted (LTN → STN): CONFIRMING, then found on refresh without re-sending', async () => {
    const { trip, priced } = await tripAndQuote('LTN', 'STN');
    const b = (await book(trip.id, priced.quote)).body.data;
    expect(b.state).toBe('CONFIRMING');
    const r = await user.post(`/bookings/${b.id}/refresh`);
    expect(r.body.data.state).toBe('TICKETED');
    expect(r.body.data.pnr).toMatch(/^[A-Z0-9]{6}$/);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM booking_events WHERE event = 'ORDER_SENT'");
    expect(rows[0].n).toBe(1); // sent exactly once
  });

  it('202 but the order never appears (LCY → STN): stays CONFIRMING', async () => {
    const { trip, priced } = await tripAndQuote('LCY', 'STN');
    const b = (await book(trip.id, priced.quote)).body.data;
    const r = await user.post(`/bookings/${b.id}/refresh`);
    expect(r.body.data.state).toBe('CONFIRMING');
  });

  it('airline error on order (LHR → LGW): NEEDS_ATTENTION', async () => {
    const { trip, priced } = await tripAndQuote('LHR', 'LGW');
    const b = (await book(trip.id, priced.quote)).body.data;
    expect(b.state).toBe('NEEDS_ATTENTION');
    expect(b.failureReason).toMatch(/team will review/);
  });

  it('insufficient balance (LGW → STN): NEEDS_ATTENTION', async () => {
    const { trip, priced } = await tripAndQuote('LGW', 'STN');
    expect((await book(trip.id, priced.quote)).body.data.state).toBe('NEEDS_ATTENTION');
  });
});
