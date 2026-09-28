// A stand-in for the Gemini API, for automated tests. It understands just enough of the
// generateContent format to drive the agent loop the way the real model does:
//   "flights from DXB to LHR on 2026-12-15 for 2 adults" → calls search_flights,
//   then answers using the cheapest price from the tool result.
//   "check price of the cheapest" → calls check_price on the cheapest option seen.
//   "INVENT" in the message → answers with a made-up price (tests the grounding guard).
import express from 'express';

type Part = { text?: string; functionCall?: { name: string; args: Record<string, unknown> }; functionResponse?: { name: string; response: any } };
type Content = { role: string; parts: Part[] };

export function createFakeGemini() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.post('/v1beta/models/:modelAction', (req, res) => {
    if (!req.get('x-goog-api-key')) return res.status(403).json({ error: { code: 403, message: 'Method doesn\'t allow unregistered callers', status: 'PERMISSION_DENIED' } });
    const contents: Content[] = req.body.contents ?? [];
    const last = contents.at(-1)!;
    const lastUserText = [...contents].reverse().find((c) => c.role === 'user' && c.parts.some((p) => p.text))?.parts.find((p) => p.text)?.text ?? '';
    const reply = (parts: Part[]) => res.json({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 42 } });

    const fr = last.parts.find((p) => p.functionResponse)?.functionResponse;
    if (fr) {
      if (/INVENT/.test(lastUserText)) return reply([{ text: 'The cheapest flight is 123.45 USD.' }]);
      if (fr.name === 'search_flights') {
        const opts = fr.response.options ?? [];
        if (fr.response.error) return reply([{ text: `I could not search: ${fr.response.error}` }]);
        if (!opts.length) return reply([{ text: 'I found no flights for those dates.' }]);
        return reply([{ text: `I found ${opts.length} options. The cheapest is ${opts[0].airline} at ${opts[0].total_price}.` }]);
      }
      if (fr.name === 'check_price') {
        const r = fr.response;
        if (r.status === 'NO_LONGER_AVAILABLE') return reply([{ text: 'That fare is no longer available.' }]);
        return reply([{ text: r.status === 'PRICE_CHANGED' ? `The price changed from ${r.earlier_price} to ${r.current_price}.` : `The price is still ${r.current_price}.` }]);
      }
      return reply([{ text: 'Done.' }]);
    }

    const m = /from ([A-Z]{3}) to ([A-Z]{3}) on (\d{4}-\d{2}-\d{2})(?: for (\d) adults?)?/i.exec(lastUserText);
    if (m) {
      return reply([{ functionCall: { name: 'search_flights', args: { origin: m[1]!.toUpperCase(), destination: m[2]!.toUpperCase(), departure_date: m[3], adults: Number(m[4] ?? 1) } } }]);
    }
    if (/check (the )?price/i.test(lastUserText)) {
      const seen = contents.flatMap((c) => c.parts).map((p) => p.functionResponse).filter((f) => f?.name === 'search_flights').at(-1);
      const id = seen?.response?.options?.[0]?.option_id;
      if (id) return reply([{ functionCall: { name: 'check_price', args: { option_id: id } } }]);
    }
    return reply([{ text: 'Where would you like to fly, on which date, and for how many travellers?' }]);
  });
  return app;
}
