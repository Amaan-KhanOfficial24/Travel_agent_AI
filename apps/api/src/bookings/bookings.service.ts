// Booking saga: reprice → order → confirmed, with fare-change recovery.
//
//   REPRICING ─ same or lower price ─▶ ORDERING ─ 201 ─▶ TICKETED
//      │                                  │ ├─ 202 / timeout ─▶ CONFIRMING ─ found ─▶ TICKETED
//      │ gone / higher                    │ └─ offer gone ─┐
//      ▼                                  ▼                ▼
//   RECOVERY ─ alternative found ─▶ AWAITING_APPROVAL ─ approve ─▶ REPRICING (next attempt)
//      │                                  └─ decline ─▶ CANCELLED
//      └─ no match / limits hit ─▶ FAILED            anything unexpected ─▶ NEEDS_ATTENTION
//
// Every transition is a conditional UPDATE (WHERE state = expected), so two clicks or two
// servers can never both move the same booking. Every step is written to booking_events.
import type pg from 'pg';
import type { SessionUser } from '../auth/sessions.js';
import { config } from '../config.js';
import { pool, withTransaction } from '../db/pool.js';
import { AppError, badRequest, notFound } from '../errors.js';
import { flightsService, type Quote, type StoredOffer } from '../flights/flights.service.js';
import { logger } from '../logger.js';
import { fromMinor, pctChange, toMinor } from '../money.js';
import { duffel, ProviderError } from '../providers/duffel/client.js';
import { tripsRepository } from '../trips/trips.repository.js';
import type { Passenger } from '../trips/trips.schema.js';
import { findAlternatives } from './matching.js';

export type BookingState =
  | 'REPRICING' | 'ORDERING' | 'CONFIRMING' | 'TICKETED' | 'RECOVERY'
  | 'AWAITING_APPROVAL' | 'CANCELLED' | 'FAILED' | 'NEEDS_ATTENTION';

const ALLOWED: Record<BookingState, BookingState[]> = {
  REPRICING: ['ORDERING', 'RECOVERY', 'NEEDS_ATTENTION'],
  ORDERING: ['TICKETED', 'CONFIRMING', 'RECOVERY', 'FAILED', 'NEEDS_ATTENTION'],
  CONFIRMING: ['TICKETED', 'NEEDS_ATTENTION'],
  RECOVERY: ['AWAITING_APPROVAL', 'FAILED', 'NEEDS_ATTENTION'],
  AWAITING_APPROVAL: ['REPRICING', 'CANCELLED', 'FAILED'],
  TICKETED: [],
  CANCELLED: [],
  FAILED: [],
  NEEDS_ATTENTION: ['TICKETED', 'FAILED'],
};

type BookingRow = {
  id: string; user_id: string; trip_id: string; search_id: string; state: BookingState; attempt_count: number;
  original_amount: string; currency: string; contact_email: string; contact_phone: string;
  provider_order_id: string | null; pnr: string | null; tickets: { passengerId?: string; number: string }[];
  paid_amount: string | null; failure_reason: string | null; created_at: Date; updated_at: Date;
};

class Machine {
  constructor(public row: BookingRow) {}

  async event(event: string, detail: Record<string, unknown> = {}, db: Pick<pg.Pool, 'query'> = pool) {
    await db.query('INSERT INTO booking_events (booking_id, event, detail) VALUES ($1, $2, $3)', [this.row.id, event, detail]);
  }

  /** Move to `to` only if nobody else moved the booking first. */
  async go(to: BookingState, event: string, detail: Record<string, unknown> = {}, set: Partial<Record<string, unknown>> = {}) {
    const from = this.row.state;
    if (!ALLOWED[from].includes(to)) throw new Error(`Illegal booking transition ${from} -> ${to}`);
    const cols = Object.keys(set);
    const assignments = cols.map((c, i) => `${c} = $${i + 4}`).join(', ');
    await withTransaction(async (tx) => {
      const { rows } = await tx.query<BookingRow>(
        `UPDATE bookings SET state = $2, version = version + 1, updated_at = now()${assignments ? ', ' + assignments : ''}
          WHERE id = $1 AND state = $3 RETURNING *`,
        [this.row.id, to, from, ...cols.map((c) => set[c])],
      );
      if (!rows[0]) throw new AppError(409, 'BOOKING_CHANGED', 'This booking was updated elsewhere. Refresh and try again.');
      await tx.query('INSERT INTO booking_events (booking_id, from_state, to_state, event, detail) VALUES ($1, $2, $3, $4, $5)', [
        this.row.id, from, to, event, detail,
      ]);
      this.row = rows[0];
    });
    logger.info({ bookingId: this.row.id, from, to, event }, 'Booking transition');
  }
}

// ---------- passenger mapping: our trip passengers → the offer's passenger slots ----------

const TITLES = ['mr', 'ms', 'mrs', 'miss', 'dr'] as const;
export type PassengerDetails = { passengerId: string; title: (typeof TITLES)[number]; gender: 'm' | 'f' };

function ageOn(bornOn: string, onDate: string) {
  const [by, bm, bd] = bornOn.split('-').map(Number) as [number, number, number];
  const [y, m, d] = onDate.slice(0, 10).split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

function mapPassengers(offer: StoredOffer, pax: Passenger[], contact: { email: string; phone: string }) {
  const departure = offer.slices[0]?.departingAt ?? '';
  const adultsOffer = offer.passengers.filter((p) => p.type === 'adult');
  const minorsOffer = offer.passengers.filter((p) => p.type !== 'adult').sort((a, b) => (a.age ?? 0) - (b.age ?? 0));
  const adults = pax.filter((p) => p.paxType === 'adult');
  // Youngest first on both sides, so each child lands in the fare slot for their age.
  const minors = pax.filter((p) => p.paxType !== 'adult').sort((a, b) => ageOn(a.bornOn, departure) - ageOn(b.bornOn, departure));
  if (adults.length !== adultsOffer.length || minors.length !== minorsOffer.length) {
    throw badRequest('Request validation failed', [
      { field: 'passengers', message: `This fare is for ${adultsOffer.length} adult(s) and ${minorsOffer.length} child(ren); the trip has ${adults.length} and ${minors.length}` },
    ]);
  }
  const pairs = [...adults.map((p, i) => [p, adultsOffer[i]!] as const), ...minors.map((p, i) => [p, minorsOffer[i]!] as const)];
  const infants = pairs.filter(([, o]) => o.type === 'infant');
  return pairs.map(([p, o], idx) => {
    if (!p.title || !p.gender) {
      throw badRequest('Request validation failed', [{ field: `passengers.${idx}`, message: `Title and gender are required for ${p.givenName} ${p.familyName}` }]);
    }
    const body: Record<string, unknown> = {
      id: o.providerPassengerId,
      title: p.title,
      gender: p.gender,
      given_name: p.givenName,
      family_name: p.familyName,
      born_on: p.bornOn,
      email: contact.email,
      phone_number: contact.phone,
    };
    const adultIndex = adults.indexOf(p);
    if (adultIndex >= 0 && infants[adultIndex]) body.infant_passenger_id = infants[adultIndex]![1].providerPassengerId;
    return body;
  });
}

// ---------- the saga ----------

async function load(actor: SessionUser, bookingId: string): Promise<Machine> {
  const { rows } = await pool.query<BookingRow>(
    `SELECT * FROM bookings WHERE id = $1 AND ($2::uuid IS NULL OR user_id = $2)`,
    [bookingId, actor.role === 'admin' ? null : actor.id],
  );
  if (!rows[0]) throw notFound('Booking not found');
  return new Machine(rows[0]);
}

async function currentAttempt(bookingId: string) {
  const { rows } = await pool.query<{ attempt_no: number; quote_id: string; consented_amount: string; offer_id: string }>(
    `SELECT a.attempt_no, a.quote_id, a.consented_amount, q.offer_id FROM booking_attempts a JOIN quotes q ON q.id = a.quote_id
      WHERE a.booking_id = $1 ORDER BY a.attempt_no DESC LIMIT 1`,
    [bookingId],
  );
  return rows[0]!;
}

async function setAttemptOutcome(bookingId: string, attemptNo: number, outcome: string, errorCode?: string) {
  await pool.query('UPDATE booking_attempts SET outcome = $3, error_code = $4 WHERE booking_id = $1 AND attempt_no = $2', [
    bookingId, attemptNo, outcome, errorCode ?? null,
  ]);
}

function ticketsFrom(order: { documents?: { type: string; unique_identifier: string; passenger_ids?: string[] }[] }) {
  return (order.documents ?? [])
    .filter((d) => d.type === 'electronic_ticket')
    .map((d) => ({ number: d.unique_identifier, ...(d.passenger_ids?.[0] ? { passengerId: d.passenger_ids[0] } : {}) }));
}

async function recover(
  actor: SessionUser,
  m: Machine,
  reason: string,
  attempt: { attempt_no: number; offer_id: string },
  sameFlightNewPrice?: StoredOffer, // the same offer, repriced: offer it directly, no re-search needed
) {
  await m.go('RECOVERY', 'RECOVERY_STARTED', { reason });

  if (m.row.attempt_count >= config.BOOKING_MAX_ATTEMPTS) {
    await m.go('FAILED', 'RECOVERY_STOPPED', { reason: 'MAX_ATTEMPTS', maxAttempts: config.BOOKING_MAX_ATTEMPTS }, {
      failure_reason: `We tried ${m.row.attempt_count} times and the fare kept changing. Please search again.`,
    });
    return;
  }

  const previous = await flightsService.getOffer(actor, attempt.offer_id);
  let best: { offer: StoredOffer; tier: 'EXACT' | 'SAME_FLIGHTS_NEW_FARE' | 'EQUIVALENT' } | undefined;
  if (sameFlightNewPrice) {
    best = { offer: sameFlightNewPrice, tier: 'EXACT' };
  } else {
    let candidates: StoredOffer[];
    try {
      candidates = await flightsService.researchFor(actor, m.row.search_id);
    } catch (err) {
      await m.go('NEEDS_ATTENTION', 'RECOVERY_SEARCH_FAILED', { error: (err as Error).message }, { failure_reason: 'We could not search again. Our team will review this booking.' });
      return;
    }
    await m.event('RECOVERY_SEARCH', { candidates: candidates.length });
    best = findAlternatives(previous, candidates)[0];
  }

  const original = toMinor(m.row.original_amount);
  if (!best) {
    await m.go('FAILED', 'NO_ALTERNATIVE', {}, { failure_reason: 'This flight is no longer available and we found no equivalent flight.' });
    return;
  }
  const increase = pctChange(original, toMinor(best.offer.totalAmount));
  if (increase > config.BOOKING_MAX_INCREASE_PCT) {
    await m.go('FAILED', 'PRICE_INCREASE_LIMIT', { increasePct: increase, limitPct: config.BOOKING_MAX_INCREASE_PCT }, {
      failure_reason: `The best available fare is ${increase}% above your original price, over our ${config.BOOKING_MAX_INCREASE_PCT}% limit. Please search again.`,
    });
    return;
  }
  const quote = await flightsService.createQuote(actor, best.offer, {
    referenceAmount: m.row.original_amount,
    status: best.tier === 'EXACT' ? 'PRICE_CHANGED' : 'ALTERNATIVE',
    matchTier: best.tier,
    bookingId: m.row.id,
  });
  await m.go('AWAITING_APPROVAL', 'APPROVAL_REQUESTED', {
    reason,
    quoteId: quote.id,
    tier: best.tier,
    originalAmount: m.row.original_amount,
    newAmount: quote.totalAmount,
    difference: quote.difference,
    currency: quote.currency,
  });
}

async function runAttempt(actor: SessionUser, m: Machine) {
  const attempt = await currentAttempt(m.row.id);
  const consented = toMinor(attempt.consented_amount);

  // 1. Reprice: the offer may have changed since the customer agreed.
  let fresh: StoredOffer | null;
  try {
    fresh = await flightsService.refreshOffer(actor, attempt.offer_id);
  } catch (err) {
    await m.go('NEEDS_ATTENTION', 'REPRICE_FAILED', { error: (err as Error).message }, { failure_reason: 'We could not confirm the price with the airline. Please try again later.' });
    return;
  }
  if (!fresh) {
    await setAttemptOutcome(m.row.id, attempt.attempt_no, 'OFFER_GONE');
    return recover(actor, m, 'OFFER_GONE', attempt);
  }
  const current = toMinor(fresh.totalAmount);
  await m.event('REPRICED', { consented: attempt.consented_amount, current: fresh.totalAmount, currency: fresh.currency });
  if (current > consented) {
    await setAttemptOutcome(m.row.id, attempt.attempt_no, 'PRICE_INCREASED');
    return recover(actor, m, 'PRICE_INCREASED', attempt, fresh);
  }

  // 2. Order. The amount sent is the fresh price, never more than the customer agreed to.
  await m.go('ORDERING', 'ORDER_SENT', { amount: fresh.totalAmount, currency: fresh.currency });
  const pax = await tripsRepository.listPassengers(m.row.trip_id);
  let result: Awaited<ReturnType<typeof duffel.createOrder>>;
  try {
    result = await duffel.createOrder({
      selected_offers: [fresh.providerOfferId],
      passengers: mapPassengers(fresh, pax, { email: m.row.contact_email, phone: m.row.contact_phone }),
      amount: fresh.totalAmount,
      currency: fresh.currency,
      metadata: { booking_id: m.row.id, attempt: String(attempt.attempt_no) },
    });
  } catch (err) {
    if (err instanceof ProviderError) {
      await m.event('ORDER_ERROR', { category: err.category, code: err.code, status: err.status, providerRequestId: err.providerRequestId, message: err.message });
      if (err.category === 'OFFER_UNAVAILABLE') {
        await setAttemptOutcome(m.row.id, attempt.attempt_no, 'OFFER_UNAVAILABLE_AT_ORDER', err.code);
        return recover(actor, m, 'OFFER_UNAVAILABLE_AT_ORDER', attempt);
      }
      if (!err.outcomeKnown) {
        // Timeout or 5xx on a write: the airline MAY have booked it. Never resend; look it up.
        await setAttemptOutcome(m.row.id, attempt.attempt_no, 'OUTCOME_UNKNOWN', err.code ?? err.category);
        return m.go('CONFIRMING', 'ORDER_OUTCOME_UNKNOWN', { category: err.category });
      }
      if (err.category === 'INVALID_REQUEST') {
        await setAttemptOutcome(m.row.id, attempt.attempt_no, 'REJECTED', err.code);
        return m.go('FAILED', 'ORDER_REJECTED', { code: err.code }, { failure_reason: `The airline rejected the booking: ${err.message}` });
      }
      await setAttemptOutcome(m.row.id, attempt.attempt_no, 'ERROR', err.code ?? err.category);
      return m.go('NEEDS_ATTENTION', 'ORDER_FAILED', { category: err.category }, { failure_reason: 'The booking could not be completed. Our team will review it.' });
    }
    throw err;
  }

  if (result.status === 201 && result.order) {
    await setAttemptOutcome(m.row.id, attempt.attempt_no, 'SUCCESS');
    return m.go('TICKETED', 'ORDER_CONFIRMED', { orderId: result.order.id, pnr: result.order.booking_reference }, {
      provider_order_id: result.order.id,
      pnr: result.order.booking_reference,
      tickets: JSON.stringify(ticketsFrom(result.order)),
      paid_amount: result.order.total_amount,
    });
  }
  // 200/202: accepted but not yet confirmed by the airline.
  await setAttemptOutcome(m.row.id, attempt.attempt_no, 'PENDING');
  return m.go('CONFIRMING', 'ORDER_ACCEPTED_PENDING', { httpStatus: result.status }, result.order?.id ? { provider_order_id: result.order.id } : {});
}

// ---------- public API ----------

export type StartBookingInput = {
  quoteId: string;
  confirmedAmount: string;
  tripId: string;
  contact: { email: string; phone: string };
  passengers: PassengerDetails[];
};

function assertConsent(quote: Quote, confirmedAmount: string) {
  if (toMinor(confirmedAmount) !== toMinor(quote.totalAmount)) {
    throw new AppError(409, 'CONSENT_MISMATCH', `The price is ${quote.currency} ${quote.totalAmount}, not ${confirmedAmount}. Please review and confirm again.`);
  }
  if (Date.parse(quote.expiresAt) < Date.now()) {
    throw new AppError(409, 'QUOTE_EXPIRED', 'This price has expired. Please check the price again.');
  }
}

export const bookingsService = {
  async start(actor: SessionUser, input: StartBookingInput) {
    const quote = await flightsService.getQuote(actor, input.quoteId);
    assertConsent(quote, input.confirmedAmount);

    // Validate passengers against the trip and the fare before touching the supplier.
    const trip = await tripsRepository.findById(input.tripId, { userId: actor.id });
    if (!trip) throw notFound('Trip not found');
    const { rows: done } = await pool.query("SELECT 1 FROM bookings WHERE trip_id = $1 AND state = 'TICKETED'", [trip.id]);
    if (done.length) throw new AppError(409, 'ALREADY_BOOKED', 'This trip is already booked.');
    const pax = await tripsRepository.listPassengers(trip.id);
    const details = new Map(input.passengers.map((p) => [p.passengerId, p]));
    const missing = pax.filter((p) => !details.has(p.id) && !(p.title && p.gender));
    if (missing.length) {
      throw badRequest('Request validation failed', missing.map((p) => ({ field: 'passengers', message: `Title and gender are required for ${p.givenName} ${p.familyName}` })));
    }
    const merged = pax.map((p) => ({ ...p, ...(details.get(p.id) ? { title: details.get(p.id)!.title, gender: details.get(p.id)!.gender } : {}) }));
    mapPassengers(quote.offer, merged, input.contact); // throws a 400 on any mismatch

    const bookingId = await withTransaction(async (tx) => {
      for (const p of input.passengers) {
        if (merged.some((m) => m.id === p.passengerId)) await tripsRepository.updateBookingDetails(p.passengerId, p, tx);
      }
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO bookings (user_id, trip_id, search_id, state, attempt_count, original_amount, currency, contact_email, contact_phone)
         VALUES ($1, $2, $3, 'REPRICING', 1, $4, $5, $6, $7) RETURNING id`,
        [actor.id, trip.id, quote.offer.searchId, quote.totalAmount, quote.currency, input.contact.email, input.contact.phone],
      );
      const id = rows[0]!.id;
      await tx.query('UPDATE quotes SET booking_id = $2 WHERE id = $1', [quote.id, id]);
      await tx.query('INSERT INTO booking_attempts (booking_id, attempt_no, quote_id, consented_amount) VALUES ($1, 1, $2, $3)', [
        id, quote.id, quote.totalAmount,
      ]);
      await tx.query(`INSERT INTO booking_events (booking_id, to_state, event, detail) VALUES ($1, 'REPRICING', 'BOOKING_STARTED', $2)`, [
        id, { quoteId: quote.id, consentedAmount: quote.totalAmount, currency: quote.currency },
      ]);
      return id;
    }).catch((err) => {
      if ((err as { constraint?: string }).constraint === 'bookings_one_active_per_trip') {
        throw new AppError(409, 'BOOKING_IN_PROGRESS', 'This trip already has a booking in progress.');
      }
      throw err;
    });

    await runAttempt(actor, await load(actor, bookingId));
    return bookingsService.get(actor, bookingId);
  },

  async approve(actor: SessionUser, bookingId: string, input: { quoteId: string; confirmedAmount: string }) {
    const m = await load(actor, bookingId);
    if (m.row.state !== 'AWAITING_APPROVAL') throw new AppError(409, 'NOT_AWAITING_APPROVAL', 'This booking is not waiting for your approval.');
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM quotes WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1', [bookingId]);
    if (rows[0]?.id !== input.quoteId) throw new AppError(409, 'QUOTE_SUPERSEDED', 'This price is no longer the latest one. Refresh the booking.');
    const quote = await flightsService.getQuote(actor, input.quoteId);
    assertConsent(quote, input.confirmedAmount);

    const next = m.row.attempt_count + 1;
    await m.go('REPRICING', 'CUSTOMER_APPROVED', { quoteId: quote.id, consentedAmount: quote.totalAmount }, { attempt_count: next });
    await pool.query('INSERT INTO booking_attempts (booking_id, attempt_no, quote_id, consented_amount) VALUES ($1, $2, $3, $4)', [
      bookingId, next, quote.id, quote.totalAmount,
    ]);
    await runAttempt(actor, m);
    return bookingsService.get(actor, bookingId);
  },

  async decline(actor: SessionUser, bookingId: string) {
    const m = await load(actor, bookingId);
    if (m.row.state !== 'AWAITING_APPROVAL') throw new AppError(409, 'NOT_AWAITING_APPROVAL', 'This booking is not waiting for your approval.');
    await m.go('CANCELLED', 'CUSTOMER_DECLINED', {}, { failure_reason: 'You declined the new fare. Nothing was booked or charged.' });
    return bookingsService.get(actor, bookingId);
  },

  /** For CONFIRMING bookings: ask Duffel whether the order now exists. Never re-sends it. */
  async refresh(actor: SessionUser, bookingId: string) {
    const m = await load(actor, bookingId);
    if (m.row.state !== 'CONFIRMING' && m.row.state !== 'NEEDS_ATTENTION') return bookingsService.get(actor, bookingId);
    let order = m.row.provider_order_id ? await duffel.getOrder(m.row.provider_order_id).catch(() => null) : null;
    if (!order) {
      const attempt = await currentAttempt(bookingId);
      order = (await duffel.listRecentOrders()).find(
        (o) => o.metadata?.booking_id === bookingId && o.metadata?.attempt === String(attempt.attempt_no),
      ) ?? null;
    }
    if (order?.booking_reference) {
      await m.go('TICKETED', 'ORDER_FOUND', { orderId: order.id, pnr: order.booking_reference }, {
        provider_order_id: order.id,
        pnr: order.booking_reference,
        tickets: JSON.stringify(ticketsFrom(order)),
        paid_amount: order.total_amount,
        failure_reason: null,
      });
    } else {
      await m.event('ORDER_LOOKUP', { found: false });
      if (m.row.state === 'CONFIRMING' && Date.now() - m.row.updated_at.getTime() > 30 * 60_000) {
        await m.go('NEEDS_ATTENTION', 'CONFIRMATION_OVERDUE', {}, { failure_reason: 'The airline has not confirmed yet. Our team is checking.' });
      }
    }
    return bookingsService.get(actor, bookingId);
  },

  async get(actor: SessionUser, bookingId: string) {
    const m = await load(actor, bookingId);
    const [attempts, events, quotes, passengers] = await Promise.all([
      pool.query('SELECT attempt_no AS "attemptNo", quote_id AS "quoteId", consented_amount AS "consentedAmount", outcome, error_code AS "errorCode", consented_at AS "consentedAt" FROM booking_attempts WHERE booking_id = $1 ORDER BY attempt_no', [bookingId]),
      pool.query('SELECT from_state AS "from", to_state AS "to", event, detail, created_at AS "at" FROM booking_events WHERE booking_id = $1 ORDER BY id', [bookingId]),
      pool.query<{ id: string }>('SELECT id FROM quotes WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1', [bookingId]),
      tripsRepository.listPassengers(m.row.trip_id),
    ]);
    const r = m.row;
    const pendingQuote = r.state === 'AWAITING_APPROVAL' && quotes.rows[0] ? await flightsService.getQuote(actor, quotes.rows[0].id) : null;
    const lastQuoteOffer = quotes.rows[0] ? (await flightsService.getQuote(actor, quotes.rows[0].id)).offer : null;
    return {
      id: r.id,
      tripId: r.trip_id,
      state: r.state,
      attemptCount: r.attempt_count,
      originalAmount: r.original_amount,
      paidAmount: r.paid_amount,
      currency: r.currency,
      pnr: r.pnr,
      providerOrderId: r.provider_order_id,
      tickets: r.tickets,
      failureReason: r.failure_reason,
      contact: { email: r.contact_email, phone: r.contact_phone },
      passengers,
      offer: lastQuoteOffer,
      pendingApproval: pendingQuote
        ? { quote: pendingQuote, difference: fromMinor(toMinor(pendingQuote.totalAmount) - toMinor(r.original_amount)) }
        : null,
      attempts: attempts.rows,
      events: events.rows,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  },

  async list(actor: SessionUser) {
    const { rows } = await pool.query(
      `SELECT b.id, b.state, b.pnr, b.original_amount AS "originalAmount", b.paid_amount AS "paidAmount", b.currency,
              b.created_at AS "createdAt", t.origin, t.destination, t.departure_date AS "departureDate"
         FROM bookings b JOIN trips t ON t.id = b.trip_id
        WHERE ($1::uuid IS NULL OR b.user_id = $1)
        ORDER BY b.created_at DESC LIMIT 50`,
      [actor.role === 'admin' ? null : actor.id],
    );
    return rows;
  },
};
