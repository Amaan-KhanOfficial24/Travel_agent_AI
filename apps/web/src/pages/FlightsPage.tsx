// Search flights for a saved trip, check a price, go to booking.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/endpoints';
import type { PriceCheck, SearchResult } from '../api/types';
import { ErrorBanner } from '../components/ErrorBanner';
import { money, OfferCard, QuoteBox } from '../components/Flight';

export function FlightsPage() {
  const { id: tripId = '' } = useParams();
  const navigate = useNavigate();
  const [nonstop, setNonstop] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [check, setCheck] = useState<{ offerId: string; result: PriceCheck } | null>(null);

  const search = useCallback(() => {
    setError(null);
    setResult(null);
    setCheck(null);
    api.searchForTrip(tripId, nonstop ? 0 : undefined).then(setResult).catch(setError);
  }, [tripId, nonstop]);
  useEffect(() => {
    search();
  }, [search]);

  async function checkPrice(offerId: string) {
    setChecking(offerId);
    setError(null);
    try {
      setCheck({ offerId, result: await api.checkPrice(offerId) });
    } catch (e) {
      setError(e);
    } finally {
      setChecking(null);
    }
  }

  const bookButton = (quoteId: string, amount: string, currency: string) => (
    <button onClick={() => navigate(`/book/${quoteId}?trip=${tripId}`)}>Book for {money(amount, currency)}</button>
  );

  return (
    <main>
      <p><Link to={`/trips/${tripId}`}>← Back to trip</Link></p>
      <h1>Flights</h1>
      <label className="inline">
        <input type="checkbox" checked={nonstop} onChange={(e) => setNonstop(e.target.checked)} /> Nonstop only
      </label>
      <ErrorBanner error={error} />
      {!result && !error && <p aria-busy="true">Searching airlines… this can take up to 20 seconds.</p>}
      {result && result.offers.length === 0 && <p className="muted">No flights found for this trip. Try other dates or allow connections.</p>}
      {result && result.offers.length > 0 && <p className="muted">{result.totalFound} options found, showing the {result.offers.length} cheapest. Prices are confirmed with the airline when you check them.</p>}
      {result?.offers.map((o) => (
        <div key={o.id}>
          <OfferCard
            offer={o}
            action={
              <button onClick={() => checkPrice(o.id)} disabled={checking !== null}>
                {checking === o.id ? 'Checking…' : 'Check price'}
              </button>
            }
          />
          {check?.offerId === o.id && (
            <div className="indent">
              {check.result.available ? (
                <QuoteBox quote={check.result.quote} action={bookButton(check.result.quote.id, check.result.quote.totalAmount, check.result.quote.currency)} />
              ) : check.result.alternatives.length ? (
                <>
                  <p className="notice"><strong>This fare is no longer available.</strong> The closest alternatives:</p>
                  {check.result.alternatives.map((q) => <QuoteBox key={q.id} quote={q} action={bookButton(q.id, q.totalAmount, q.currency)} />)}
                </>
              ) : (
                <p className="notice">This fare is no longer available and there is no equivalent flight. Please choose another option.</p>
              )}
            </div>
          )}
        </div>
      ))}
    </main>
  );
}
