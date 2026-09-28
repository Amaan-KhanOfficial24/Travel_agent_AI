// Shared flight displays: an offer card, and a price-check result.
import type { ReactNode } from 'react';
import type { FlightSlice, Offer, Quote } from '../api/types';

const time = (iso: string) => iso.slice(11, 16);
const date = (iso: string) => iso.slice(0, 10);
const dur = (d: string | null) => (d ? d.replace(/^P(?:\d+D)?T?/, '').replace('H', 'h ').replace('M', 'm').toLowerCase() : '');
export const money = (amount: string, currency: string) => `${currency} ${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function SliceRow({ s }: { s: FlightSlice }) {
  return (
    <div className="slice">
      <div>
        <strong>{time(s.departingAt)}</strong> {s.origin}
        <span className="muted"> → </span>
        <strong>{time(s.arrivingAt)}</strong> {s.destination}
        <span className="muted"> · {date(s.departingAt)}</span>
      </div>
      <div className="muted small">
        {s.stops === 0 ? 'Nonstop' : `${s.stops} stop${s.stops > 1 ? 's' : ''} via ${s.segments.slice(0, -1).map((g) => g.destination).join(', ')}`}
        {s.duration ? ` · ${dur(s.duration)}` : ''} · {s.segments.map((g) => g.flightNumber).join(' + ')}
      </div>
    </div>
  );
}

export function OfferCard({ offer, action }: { offer: Offer; action?: ReactNode }) {
  return (
    <div className="offer" data-testid="offer">
      <div className="offer-main">
        <div className="airline">{offer.owner.name}{offer.fareBrand ? <span className="muted"> · {offer.fareBrand}</span> : null}</div>
        {offer.slices.map((s, i) => <SliceRow key={i} s={s} />)}
        <div className="muted small">
          {offer.cabin.replace('_', ' ')} · {offer.baggage.checked ? `${offer.baggage.checked} checked bag` : 'no checked bag'}
          {offer.refundable === true ? ' · refundable' : offer.refundable === false ? ' · non-refundable' : ''}
        </div>
      </div>
      <div className="offer-side">
        <div className="price">{money(offer.totalAmount, offer.currency)}</div>
        <div className="muted small">total, {offer.passengers.length} traveller{offer.passengers.length > 1 ? 's' : ''}</div>
        {action}
      </div>
    </div>
  );
}

/** The result of "Check price", stating clearly what changed. */
export function QuoteBox({ quote, action }: { quote: Quote; action?: ReactNode }) {
  const diff = Number(quote.difference);
  return (
    <div className={`quote ${quote.status === 'SAME_PRICE' ? 'ok' : 'changed'}`} data-testid="quote">
      {quote.status === 'SAME_PRICE' && <p><strong>Price confirmed:</strong> {money(quote.totalAmount, quote.currency)}</p>}
      {quote.status === 'PRICE_CHANGED' && (
        <p>
          <strong>The price has changed.</strong> It was {money(quote.referenceAmount, quote.currency)}, it is now{' '}
          <strong>{money(quote.totalAmount, quote.currency)}</strong> ({diff > 0 ? '+' : ''}{money(quote.difference, quote.currency)}).
        </p>
      )}
      {quote.status === 'ALTERNATIVE' && (
        <p>
          <strong>{quote.matchTier === 'EQUIVALENT' ? 'Different flight: ' : 'Same flights, different fare: '}</strong>
          {money(quote.totalAmount, quote.currency)} ({diff > 0 ? '+' : ''}{money(quote.difference, quote.currency)} vs {money(quote.referenceAmount, quote.currency)}).
        </p>
      )}
      <OfferCard offer={quote.offer} action={action} />
      <p className="muted small">Price held until {new Date(quote.expiresAt).toLocaleTimeString()}.</p>
    </div>
  );
}
