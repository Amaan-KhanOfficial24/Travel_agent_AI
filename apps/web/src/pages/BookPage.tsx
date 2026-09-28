// Confirm and book a quoted price. Works for a saved trip (?trip=<id>), or straight from
// the assistant: then the travellers are entered here and a trip is created for them.
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { api } from '../api/endpoints';
import type { Cabin, Offer, Passenger, Quote } from '../api/types';
import { ErrorBanner, fieldErrors } from '../components/ErrorBanner';
import { Field } from '../components/Field';
import { money, QuoteBox } from '../components/Flight';

type Traveller = { passengerId?: string; paxType: 'adult' | 'child' | 'infant'; title: string; gender: string; givenName: string; familyName: string; bornOn: string };

const blank = (paxType: Traveller['paxType']): Traveller => ({ paxType, title: paxType === 'adult' ? 'mr' : 'miss', gender: 'm', givenName: '', familyName: '', bornOn: '' });

export function BookPage() {
  const { quoteId = '' } = useParams();
  const [params] = useSearchParams();
  const tripId = params.get('trip');
  const navigate = useNavigate();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [travellers, setTravellers] = useState<Traveller[]>([]);
  const [contact, setContact] = useState({ email: '', phone: '' });
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  // If we created a trip on a previous (failed) attempt, reuse it instead of making another.
  const [createdTripId, setCreatedTripId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const q = await api.getQuote(quoteId);
      setQuote(q);
      if (tripId) {
        const trip = await api.getTrip(tripId);
        setTravellers((trip.passengers ?? []).map((p: Passenger) => ({ passengerId: p.id, paxType: p.paxType, title: p.title ?? (p.paxType === 'adult' ? 'mr' : 'miss'), gender: p.gender ?? 'm', givenName: p.givenName, familyName: p.familyName, bornOn: p.bornOn })));
      } else {
        setTravellers(q.offer.passengers.map((p) => blank(p.type)));
      }
      const me = await api.me();
      setContact((c) => ({ ...c, email: c.email || me.email }));
    })().catch(setError);
  }, [quoteId, tripId]);

  function set(i: number, patch: Partial<Traveller>) {
    setTravellers((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!quote) return;
    setError(null);
    setSubmitting(true);
    try {
      let useTripId = tripId ?? createdTripId;
      let withIds = travellers;
      if (!useTripId) {
        // Booking from the assistant: create the trip with these travellers first.
        const s = quote.offer.slices;
        const trip = await api.createTrip({
          origin: s[0]!.origin,
          destination: s[0]!.destination,
          departureDate: s[0]!.departingAt.slice(0, 10),
          ...(s[1] ? { returnDate: s[1].departingAt.slice(0, 10) } : {}),
          adults: travellers.filter((t) => t.paxType === 'adult').length,
          children: travellers.filter((t) => t.paxType !== 'adult').length,
          cabin: quote.offer.cabin as Cabin,
          passengers: travellers.map((t) => ({
            paxType: t.paxType,
            title: t.title as NonNullable<Passenger['title']>,
            gender: t.gender as 'm' | 'f',
            givenName: t.givenName,
            familyName: t.familyName,
            bornOn: t.bornOn,
          })),
        });
        useTripId = trip.id;
        setCreatedTripId(trip.id);
        const saved = trip.passengers ?? [];
        withIds = travellers.map((t, i) => ({ ...t, passengerId: saved[i]?.id }));
        setTravellers(withIds);
      }
      const booking = await api.startBooking({
        quoteId: quote.id,
        confirmedAmount: quote.totalAmount,
        tripId: useTripId!,
        contact,
        passengers: withIds.filter((t) => t.passengerId).map((t) => ({ passengerId: t.passengerId!, title: t.title, gender: t.gender })),
      });
      navigate(`/bookings/${booking.id}`);
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  }

  if (!quote) {
    return <main>{error ? <ErrorBanner error={error} /> : <p aria-busy="true">Loading price…</p>}</main>;
  }
  const errs = fieldErrors(error);
  const offer: Offer = quote.offer;
  return (
    <main>
      <h1>Review and book</h1>
      <QuoteBox quote={quote} />
      <form onSubmit={onSubmit} noValidate aria-label="Booking details">
        <h2>Travellers</h2>
        {travellers.map((t, i) => (
          <div className="card grid" key={i}>
            <div className="field">
              <label htmlFor={`title-${i}`}>Title</label>
              <select id={`title-${i}`} value={t.title} onChange={(e) => set(i, { title: e.target.value })}>
                {['mr', 'ms', 'mrs', 'miss', 'dr'].map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`gender-${i}`}>Gender</label>
              <select id={`gender-${i}`} value={t.gender} onChange={(e) => set(i, { gender: e.target.value })}>
                <option value="m">Male</option>
                <option value="f">Female</option>
              </select>
            </div>
            <Field label={`Given name (${t.paxType})`} name={`given-${i}`} value={t.givenName} disabled={!!(tripId ?? createdTripId)} onChange={(e) => set(i, { givenName: e.target.value })} />
            <Field label="Family name" name={`family-${i}`} value={t.familyName} disabled={!!(tripId ?? createdTripId)} onChange={(e) => set(i, { familyName: e.target.value })} />
            <Field label="Date of birth" name={`born-${i}`} type="date" value={t.bornOn} disabled={!!(tripId ?? createdTripId)} onChange={(e) => set(i, { bornOn: e.target.value })} />
          </div>
        ))}
        <h2>Contact for the airline</h2>
        <div className="card grid">
          <Field label="Email" name="contact-email" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} error={errs['contact.email']} />
          <Field label="Phone (international, e.g. +971501234567)" name="contact-phone" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} error={errs['contact.phone']} />
        </div>
        <ErrorBanner error={error} />
        <p className="muted small">This is a Duffel TEST booking: no real ticket is issued and no money is taken.</p>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Booking… (checking price, then ordering)' : `Confirm and book for ${money(quote.totalAmount, quote.currency)}`}
        </button>
        <p className="muted small">{offer.owner.name} · {offer.slices.map((s) => `${s.origin}→${s.destination}`).join(', ')}</p>
      </form>
    </main>
  );
}
