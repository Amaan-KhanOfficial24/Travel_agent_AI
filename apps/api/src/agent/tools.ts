// The only actions the AI may take. Each tool validates its input, runs as the logged-in
// user (so it can only see that user's data), and returns a compact result for the model
// plus "cards" for the web page. There is deliberately NO tool that books or pays:
// booking needs the customer's own click on a price they have seen.
import { z } from 'zod';
import type { SessionUser } from '../auth/sessions.js';
import { bookingsService } from '../bookings/bookings.service.js';
import { searchCriteriaSchema } from '../flights/flights.schema.js';
import { flightsService, type Quote, type StoredOffer } from '../flights/flights.service.js';
import { tripsService } from '../trips/trips.service.js';
import type { FunctionDeclaration } from './gemini.js';

export type Card =
  | { type: 'offers'; searchId: string; offers: StoredOffer[] }
  | { type: 'quote'; available: true; quote: Quote }
  | { type: 'alternatives'; quotes: Quote[] };

type ToolResult = { result: Record<string, unknown>; cards?: Card[] };

const brief = (o: StoredOffer) => ({
  option_id: o.id,
  airline: o.owner.name,
  total_price: `${o.totalAmount} ${o.currency}`,
  cabin: o.cabin,
  fare_brand: o.fareBrand ?? null,
  checked_bags_per_passenger: o.baggage.checked,
  refundable: o.refundable,
  journeys: o.slices.map((s) => ({
    from: s.origin,
    to: s.destination,
    departs: s.departingAt,
    arrives: s.arrivingAt,
    duration: s.duration,
    stops: s.stops,
    flights: s.segments.map((g) => g.flightNumber),
  })),
});

const briefQuote = (q: Quote) => ({
  quote_id: q.id,
  status: q.status,
  match: q.matchTier,
  earlier_price: `${q.referenceAmount} ${q.currency}`,
  current_price: `${q.totalAmount} ${q.currency}`,
  difference: `${q.difference} ${q.currency}`,
  price_valid_until: q.expiresAt,
  option: brief(q.offer),
});

export const toolDeclarations: FunctionDeclaration[] = [
  {
    name: 'search_flights',
    description:
      'Search bookable flights. Use IATA airport codes and YYYY-MM-DD dates. Returns up to 5 options, cheapest first. Prices are from the search and must be confirmed with check_price before booking.',
    parameters: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Origin airport IATA code, e.g. DXB' },
        destination: { type: 'string', description: 'Destination airport IATA code, e.g. LHR' },
        departure_date: { type: 'string', description: 'YYYY-MM-DD' },
        return_date: { type: 'string', description: 'YYYY-MM-DD, only for round trips' },
        adults: { type: 'integer', description: 'Number of adults (1-9)' },
        child_ages: { type: 'array', items: { type: 'integer' }, description: 'Age of each child on the travel date (0-17)' },
        cabin: { type: 'string', enum: ['economy', 'premium_economy', 'business', 'first'] },
        max_connections: { type: 'integer', description: '0 for nonstop only' },
      },
      required: ['origin', 'destination', 'departure_date', 'adults'],
    },
  },
  {
    name: 'check_price',
    description:
      'Get the CURRENT bookable price of an option from the airline. Always call this before the customer books. If the fare is gone it returns the closest alternatives.',
    parameters: { type: 'object', properties: { option_id: { type: 'string' } }, required: ['option_id'] },
  },
  {
    name: 'get_option_details',
    description: 'Full details of one flight option from a previous search.',
    parameters: { type: 'object', properties: { option_id: { type: 'string' } }, required: ['option_id'] },
  },
  {
    name: 'list_my_trips',
    description: "The customer's saved trips with their passengers.",
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_my_bookings',
    description: "The customer's bookings with status, booking reference (PNR) and amounts.",
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_booking',
    description: 'Status and history of one booking, including any price change waiting for approval.',
    parameters: { type: 'object', properties: { booking_id: { type: 'string' } }, required: ['booking_id'] },
  },
];

const uuid = z.uuid();

export async function runTool(actor: SessionUser, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  switch (name) {
    case 'search_flights': {
      const criteria = searchCriteriaSchema.parse({
        origin: args.origin,
        destination: args.destination,
        departureDate: args.departure_date,
        ...(args.return_date ? { returnDate: args.return_date } : {}),
        adults: Number(args.adults ?? 1),
        childAges: Array.isArray(args.child_ages) ? args.child_ages.map(Number) : [],
        ...(args.cabin ? { cabin: args.cabin } : {}),
        ...(args.max_connections !== undefined ? { maxConnections: Number(args.max_connections) } : {}),
      });
      const r = await flightsService.search(actor, { criteria });
      const top = r.offers.slice(0, 5);
      return {
        result: { total_found: r.totalFound, options: top.map(brief) },
        cards: top.length ? [{ type: 'offers', searchId: r.searchId, offers: top }] : [],
      };
    }
    case 'check_price': {
      const r = await flightsService.priceOffer(actor, uuid.parse(args.option_id));
      if (r.available) return { result: briefQuote(r.quote), cards: [{ type: 'quote', available: true, quote: r.quote }] };
      return {
        result: { status: 'NO_LONGER_AVAILABLE', alternatives: r.alternatives.map(briefQuote) },
        cards: r.alternatives.length ? [{ type: 'alternatives', quotes: r.alternatives }] : [],
      };
    }
    case 'get_option_details':
      return { result: brief(await flightsService.getOffer(actor, uuid.parse(args.option_id))) };
    case 'list_my_trips': {
      const trips = await tripsService.list(actor);
      return { result: { trips: trips.map((t) => ({ trip_id: t.id, from: t.origin, to: t.destination, departure: t.departureDate, return: t.returnDate ?? null, adults: t.adults, children: t.children, cabin: t.cabin })) } };
    }
    case 'list_my_bookings':
      return { result: { bookings: await bookingsService.list(actor) } };
    case 'get_booking': {
      const b = await bookingsService.get(actor, uuid.parse(args.booking_id));
      return {
        result: {
          booking_id: b.id, state: b.state, pnr: b.pnr, tickets: b.tickets, original_price: `${b.originalAmount} ${b.currency}`,
          paid: b.paidAmount ? `${b.paidAmount} ${b.currency}` : null, failure_reason: b.failureReason,
          awaiting_approval: b.pendingApproval ? { new_price: `${b.pendingApproval.quote.totalAmount} ${b.currency}`, difference: `${b.pendingApproval.difference} ${b.currency}` } : null,
        },
      };
    }
    default:
      return { result: { error: `Unknown tool ${name}` } };
  }
}
