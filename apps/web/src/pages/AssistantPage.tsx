// Chat with the AI travel assistant. It searches and checks prices through the API;
// booking always happens by the customer pressing "Book" on a price they have seen.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/endpoints';
import type { Card, PriceCheck } from '../api/types';
import { ErrorBanner } from '../components/ErrorBanner';
import { money, OfferCard, QuoteBox } from '../components/Flight';

type Msg = { role: 'user' | 'assistant'; text: string; cards?: Card[] };

export function AssistantPage() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', text: 'Hi! Tell me where and when you want to fly, e.g. "Dubai to London on 15 December for 2 adults and a child aged 8, nonstop, cheapest reasonable option".' },
  ]);
  const [conversationId, setConversationId] = useState<string>();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [checks, setChecks] = useState<Record<string, PriceCheck | 'loading'>>({});
  const bottom = useRef<HTMLDivElement>(null);
  // Braces matter: an effect may only return a cleanup function. Newer browsers make
  // scrollIntoView return a Promise, and returning that crashes React ("destroy is not a function").
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages, checks]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    setError(null);
    setMessages((m) => [...m, { role: 'user', text }]);
    setSending(true);
    try {
      const r = await api.chat(text, conversationId);
      setConversationId(r.conversationId);
      setMessages((m) => [...m, { role: 'assistant', text: r.reply, cards: r.cards }]);
    } catch (err) {
      setError(err);
    } finally {
      setSending(false);
    }
  }

  async function checkPrice(offerId: string) {
    setChecks((c) => ({ ...c, [offerId]: 'loading' }));
    try {
      const r = await api.checkPrice(offerId);
      setChecks((c) => ({ ...c, [offerId]: r }));
    } catch (err) {
      setError(err);
      setChecks(({ [offerId]: _gone, ...rest }) => rest);
    }
  }

  const book = (quoteId: string, amount: string, currency: string) => (
    <button onClick={() => navigate(`/book/${quoteId}`)}>Book for {money(amount, currency)}</button>
  );

  function renderCard(card: Card, key: number) {
    if (card.type === 'quote') return <QuoteBox key={key} quote={card.quote} action={book(card.quote.id, card.quote.totalAmount, card.quote.currency)} />;
    if (card.type === 'alternatives') return <div key={key}>{card.quotes.map((q) => <QuoteBox key={q.id} quote={q} action={book(q.id, q.totalAmount, q.currency)} />)}</div>;
    return (
      <div key={key}>
        {card.offers.map((o) => {
          const c = checks[o.id];
          return (
            <div key={o.id}>
              <OfferCard offer={o} action={<button disabled={c === 'loading'} onClick={() => checkPrice(o.id)}>{c === 'loading' ? 'Checking…' : 'Check price'}</button>} />
              {c && c !== 'loading' && (c.available
                ? <QuoteBox quote={c.quote} action={book(c.quote.id, c.quote.totalAmount, c.quote.currency)} />
                : c.alternatives.length
                  ? c.alternatives.map((q) => <QuoteBox key={q.id} quote={q} action={book(q.id, q.totalAmount, q.currency)} />)
                  : <p className="notice">No longer available.</p>)}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <main className="chat">
      <h1>Travel assistant</h1>
      <div className="messages" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`} data-testid={`msg-${m.role}`}>
            <div className="bubble">{m.text}</div>
            {m.cards?.map(renderCard)}
          </div>
        ))}
        {sending && <div className="msg assistant"><div className="bubble muted" aria-busy="true">Thinking…</div></div>}
        <div ref={bottom} />
      </div>
      <ErrorBanner error={error} />
      <form onSubmit={send} className="composer">
        <input aria-label="Message" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Where do you want to go?" maxLength={2000} disabled={sending} />
        <button type="submit" disabled={sending || !input.trim()}>Send</button>
      </form>
    </main>
  );
}
