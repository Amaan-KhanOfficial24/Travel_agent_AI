// One booking: status, PNR and tickets, a price change waiting for approval, and the
// full history of what happened (the audit trail).
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api/endpoints';
import type { Booking, BookingState } from '../api/types';
import { ErrorBanner } from '../components/ErrorBanner';
import { money, OfferCard, QuoteBox } from '../components/Flight';

const LABEL: Record<BookingState, string> = {
  REPRICING: 'Checking price',
  ORDERING: 'Booking with the airline',
  CONFIRMING: 'Waiting for airline confirmation',
  TICKETED: 'Confirmed',
  RECOVERY: 'Finding the fare again',
  AWAITING_APPROVAL: 'Needs your approval',
  CANCELLED: 'Cancelled',
  FAILED: 'Not booked',
  NEEDS_ATTENTION: 'Being checked by our team',
};

const EVENT_TEXT: Record<string, (d: Record<string, unknown>) => string> = {
  BOOKING_STARTED: (d) => `You agreed to ${d.currency} ${d.consentedAmount}`,
  REPRICED: (d) => `Airline price checked: ${d.currency} ${d.current}`,
  ORDER_SENT: (d) => `Order sent for ${d.currency} ${d.amount}`,
  ORDER_CONFIRMED: (d) => `Confirmed, booking reference ${d.pnr}`,
  ORDER_FOUND: (d) => `Confirmed, booking reference ${d.pnr}`,
  ORDER_ACCEPTED_PENDING: () => 'Airline accepted the order, confirmation pending',
  ORDER_OUTCOME_UNKNOWN: () => 'No answer from the airline; checking before doing anything else',
  ORDER_ERROR: (d) => `Airline answered: ${d.message ?? d.code}`,
  RECOVERY_STARTED: (d) => `Fare problem (${String(d.reason).toLowerCase().replace(/_/g, ' ')}); searching again`,
  RECOVERY_SEARCH: (d) => `Searched again: ${d.candidates} options`,
  APPROVAL_REQUESTED: (d) => `New fare ${d.currency} ${d.newAmount} (was ${d.originalAmount}, ${Number(d.difference) >= 0 ? '+' : ''}${d.difference})`,
  CUSTOMER_APPROVED: (d) => `You approved ${d.consentedAmount}`,
  CUSTOMER_DECLINED: () => 'You declined the new fare',
  RECOVERY_STOPPED: () => 'Stopped after the maximum number of attempts',
  PRICE_INCREASE_LIMIT: (d) => `New fare is ${d.increasePct}% higher, above the ${d.limitPct}% limit`,
  NO_ALTERNATIVE: () => 'No equivalent flight found',
  ORDER_LOOKUP: () => 'Checked with the airline: not confirmed yet',
};

export function BookingPage() {
  const { id = '' } = useParams();
  const [b, setB] = useState<Booking | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.getBooking(id).then(setB).catch(setError), [id]);
  useEffect(() => {
    load();
  }, [load]);

  async function act(fn: () => Promise<Booking>) {
    setBusy(true);
    setError(null);
    try {
      setB(await fn());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!b) return <main>{error ? <ErrorBanner error={error} /> : <p aria-busy="true">Loading booking…</p>}</main>;
  const p = b.pendingApproval;
  return (
    <main>
      <p><Link to="/bookings">← All bookings</Link></p>
      <h1>
        Booking <span className={`badge s-${b.state.toLowerCase()}`} data-testid="booking-state">{LABEL[b.state]}</span>
      </h1>

      {b.state === 'TICKETED' && (
        <div className="card success">
          <p className="big">Booking reference <strong data-testid="pnr">{b.pnr}</strong></p>
          <p>Paid {money(b.paidAmount ?? b.originalAmount, b.currency)}{b.paidAmount !== b.originalAmount ? ` (first agreed ${money(b.originalAmount, b.currency)})` : ''}</p>
          <table>
            <thead><tr><th>Passenger</th><th>E-ticket</th></tr></thead>
            <tbody>
              {b.passengers.map((px, i) => (
                <tr key={px.id}><td>{px.title?.toUpperCase()} {px.givenName} {px.familyName}</td><td>{b.tickets[i]?.number ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Duffel test mode: this ticket is not valid for travel.</p>
        </div>
      )}

      {p && (
        <div className="card attention" data-testid="approval">
          <h2>The fare changed while booking</h2>
          <p>
            You agreed to <strong>{money(b.originalAmount, b.currency)}</strong>. The best available now is{' '}
            <strong>{money(p.quote.totalAmount, b.currency)}</strong> ({Number(p.difference) >= 0 ? '+' : ''}{money(p.difference, b.currency)}).
            {p.quote.matchTier === 'EQUIVALENT' && <strong> This is a different flight; check the times below.</strong>}
          </p>
          <QuoteBox quote={p.quote} />
          <button disabled={busy} onClick={() => act(() => api.approveBooking(b.id, p.quote.id, p.quote.totalAmount))}>
            {busy ? 'Booking…' : `Approve ${money(p.quote.totalAmount, b.currency)} and book`}
          </button>{' '}
          <button className="secondary" disabled={busy} onClick={() => act(() => api.declineBooking(b.id))}>Decline</button>
        </div>
      )}

      {(b.state === 'CONFIRMING' || b.state === 'NEEDS_ATTENTION') && (
        <div className="card attention">
          <p>{b.failureReason ?? 'The airline accepted the order and is confirming it. This usually takes a moment.'}</p>
          <button disabled={busy} onClick={() => act(() => api.refreshBooking(b.id))}>{busy ? 'Checking…' : 'Check status'}</button>
        </div>
      )}
      {(b.state === 'FAILED' || b.state === 'CANCELLED') && (
        <div className="card attention">
          <p>{b.failureReason}</p>
          <Link to={`/trips/${b.tripId}/flights`}>Search again</Link>
        </div>
      )}
      <ErrorBanner error={error} />

      {b.offer && !p && <OfferCard offer={b.offer} />}

      <h2>History</h2>
      <ol className="timeline">
        {b.events.map((e, i) => (
          <li key={i}>
            <span className="muted small">{new Date(e.at).toLocaleTimeString()}</span> {EVENT_TEXT[e.event]?.(e.detail) ?? e.event}
          </li>
        ))}
      </ol>
    </main>
  );
}

export function BookingsPage() {
  const [list, setList] = useState<Awaited<ReturnType<typeof api.listBookings>> | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    api.listBookings().then(setList).catch(setError);
  }, []);
  return (
    <main>
      <h1>My bookings</h1>
      <ErrorBanner error={error} />
      {!list && !error && <p aria-busy="true">Loading…</p>}
      {list?.length === 0 && <p className="muted">No bookings yet. Open a trip and search flights, or ask the assistant.</p>}
      <ul className="trip-list">
        {list?.map((b) => (
          <li key={b.id}>
            <Link to={`/bookings/${b.id}`}>
              <strong>{b.origin} → {b.destination}</strong>
              <span>{b.departureDate}</span>
              <span className={`badge s-${b.state.toLowerCase()}`}>{LABEL[b.state]}</span>
              <span className="muted">{b.pnr ?? ''} {money(b.paidAmount ?? b.originalAmount, b.currency)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
