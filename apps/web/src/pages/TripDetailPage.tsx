// One trip: its details, its passengers, a form to add a passenger, and delete.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { api } from '../api/endpoints';
import type { NewPassenger, PaxType, Trip } from '../api/types';
import { ErrorBanner, fieldErrors } from '../components/ErrorBanner';
import { Field } from '../components/Field';

export function TripDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    setError(null);
    api.getTrip(id).then(setTrip).catch(setError);
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  async function onDelete() {
    if (!window.confirm('Delete this trip and all its passengers?')) return;
    try {
      await api.deleteTrip(id);
      navigate('/trips');
    } catch (err) {
      setError(err);
    }
  }

  // 404 covers both "does not exist" and "belongs to someone else": the API doesn't say which.
  if (error instanceof ApiError && error.status === 404) {
    return (
      <main>
        <h1>Trip not found</h1>
        <p className="muted">It may have been deleted, or the link is wrong.</p>
      </main>
    );
  }
  if (error && !trip) return <main><ErrorBanner error={error} /><button onClick={load}>Try again</button></main>;
  if (!trip) return <main><p aria-busy="true">Loading trip…</p></main>;

  const passengers = trip.passengers ?? [];
  return (
    <main>
      <h1>{trip.origin} → {trip.destination}</h1>
      <p>
        {trip.departureDate}{trip.returnDate ? ` – ${trip.returnDate}` : ' (one way)'} · {trip.cabin.replace('_', ' ')} · {trip.adults} adult(s), {trip.children} child(ren)
      </p>

      <h2>Passengers ({passengers.length} of {trip.adults + trip.children})</h2>
      {passengers.length === 0 ? (
        <p className="muted">No passengers yet.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Name</th><th>Type</th><th>Born</th></tr>
          </thead>
          <tbody>
            {passengers.map((p) => (
              <tr key={p.id}>
                {/* React escapes text: a name like "<script>" is shown, never run. */}
                <td>{p.title ? `${p.title.toUpperCase()} ` : ''}{p.givenName} {p.familyName}</td>
                <td>{p.paxType}</td>
                <td>{p.bornOn}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {passengers.length === trip.adults + trip.children ? (
        <p><Link className="button" to={`/trips/${trip.id}/flights`}>Search flights for this trip</Link></p>
      ) : (
        <p className="muted">Add all {trip.adults + trip.children} passengers to search flights.</p>
      )}

      <AddPassengerForm tripId={trip.id} onAdded={load} />
      <ErrorBanner error={error} />
      <button className="danger" onClick={onDelete}>Delete trip</button>
    </main>
  );
}

function AddPassengerForm({ tripId, onAdded }: { tripId: string; onAdded: () => void }) {
  const empty: NewPassenger = { paxType: 'adult', givenName: '', familyName: '', bornOn: '' };
  const [p, setP] = useState<NewPassenger>(empty);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.addPassenger(tripId, p);
      setP(empty);
      onAdded();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  const errs = fieldErrors(error);
  return (
    <form onSubmit={onSubmit} className="card grid" noValidate aria-label="Add passenger">
      <div className="field">
        <label htmlFor="paxType">Type</label>
        <select id="paxType" value={p.paxType} onChange={(e) => setP({ ...p, paxType: e.target.value as PaxType })}>
          <option value="adult">Adult</option>
          <option value="child">Child</option>
          <option value="infant">Infant</option>
        </select>
      </div>
      <Field label="Given name" name="givenName" value={p.givenName} onChange={(e) => setP({ ...p, givenName: e.target.value })} error={errs.givenName} />
      <Field label="Family name" name="familyName" value={p.familyName} onChange={(e) => setP({ ...p, familyName: e.target.value })} error={errs.familyName} />
      <Field label="Date of birth" name="bornOn" type="date" value={p.bornOn} onChange={(e) => setP({ ...p, bornOn: e.target.value })} error={errs.bornOn} />
      <div className="span-all">
        <ErrorBanner error={error} />
        <button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add passenger'}</button>
      </div>
    </form>
  );
}
