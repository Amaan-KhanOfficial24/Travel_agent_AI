// "My trips": the list, plus a form to create a new one.
// Shows the three states every screen that loads data must handle: loading, error, loaded.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/endpoints';
import type { Cabin, Trip } from '../api/types';
import { ErrorBanner, fieldErrors } from '../components/ErrorBanner';
import { Field } from '../components/Field';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export function TripsPage() {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false; // ignore a late response if the user already left this page
    setLoadError(null);
    api
      .listTrips()
      .then((t) => !cancelled && setTrips(t))
      .catch((e) => !cancelled && setLoadError(e));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <main>
      <h1>My trips</h1>
      <NewTripForm />
      <h2>Saved trips</h2>
      {loadError ? (
        <>
          <ErrorBanner error={loadError} />
          <button onClick={() => setReloadKey((k) => k + 1)}>Try again</button>
        </>
      ) : trips === null ? (
        <p aria-busy="true">Loading trips…</p>
      ) : trips.length === 0 ? (
        <p className="muted">No trips yet. Create your first one above.</p>
      ) : (
        <ul className="trip-list">
          {trips.map((t) => (
            <li key={t.id}>
              <Link to={`/trips/${t.id}`}>
                <strong>{t.origin} → {t.destination}</strong>
                <span>{t.departureDate}{t.returnDate ? ` – ${t.returnDate}` : ''}</span>
                <span className="muted">
                  {t.adults} adult{t.adults > 1 ? 's' : ''}{t.children ? `, ${t.children} child${t.children > 1 ? 'ren' : ''}` : ''} · {t.cabin.replace('_', ' ')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function NewTripForm() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ origin: '', destination: '', departureDate: inDays(30), returnDate: '', adults: 1, children: 0, cabin: 'economy' as Cabin });
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: k === 'adults' || k === 'children' ? Number(e.target.value) : e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const trip = await api.createTrip({ ...form, returnDate: form.returnDate || undefined });
      navigate(`/trips/${trip.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  const errs = fieldErrors(error);
  return (
    <form onSubmit={onSubmit} className="card grid" noValidate aria-label="New trip">
      <Field label="From (IATA)" name="origin" maxLength={3} placeholder="DXB" value={form.origin} onChange={set('origin')} error={errs.origin} />
      <Field label="To (IATA)" name="destination" maxLength={3} placeholder="LHR" value={form.destination} onChange={set('destination')} error={errs.destination} />
      <Field label="Departure" name="departureDate" type="date" value={form.departureDate} onChange={set('departureDate')} error={errs.departureDate} />
      <Field label="Return (optional)" name="returnDate" type="date" value={form.returnDate} onChange={set('returnDate')} error={errs.returnDate} />
      <Field label="Adults" name="adults" type="number" min={1} max={9} value={form.adults} onChange={set('adults')} error={errs.adults} />
      <Field label="Children" name="children" type="number" min={0} max={8} value={form.children} onChange={set('children')} error={errs.children} />
      <div className="field">
        <label htmlFor="cabin">Cabin</label>
        <select id="cabin" value={form.cabin} onChange={set('cabin')}>
          <option value="economy">Economy</option>
          <option value="premium_economy">Premium economy</option>
          <option value="business">Business</option>
          <option value="first">First</option>
        </select>
      </div>
      <div className="span-all">
        <ErrorBanner error={error} />
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create trip'}</button>
      </div>
    </form>
  );
}
