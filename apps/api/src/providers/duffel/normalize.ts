// Turn Duffel's large offer objects into the small, provider-neutral shape the rest of
// the app (and the AI agent) works with. If a second provider is added later, it gets
// its own normalize file producing the same FlightOffer shape.
import type { DuffelOffer } from './types.js';

export type FlightSegment = {
  carrier: string; // marketing carrier IATA code
  carrierName: string;
  flightNumber: string; // e.g. "EK1"
  operatedBy?: string;
  origin: string;
  destination: string;
  departingAt: string; // local time at origin
  arrivingAt: string; // local time at destination
  duration: string | null;
  aircraft?: string;
};

export type FlightSlice = {
  origin: string;
  destination: string;
  departingAt: string;
  arrivingAt: string;
  duration: string | null;
  stops: number;
  segments: FlightSegment[];
};

export type FlightOffer = {
  providerOfferId: string;
  owner: { code: string; name: string; logoUrl?: string };
  totalAmount: string;
  currency: string;
  baseAmount?: string;
  taxAmount?: string;
  expiresAt: string;
  cabin: string;
  fareBrand?: string;
  slices: FlightSlice[];
  baggage: { checked: number; carryOn: number };
  refundable: boolean | null;
  changeable: boolean | null;
  passengers: { providerPassengerId: string; type: 'adult' | 'child' | 'infant'; age?: number }[];
  requiresInstantPayment: boolean;
  /** Identifies the exact flights: same key = same planes on the same days. */
  itineraryKey: string;
};

const paxType = (p: { type?: string | null; age?: number | null }): 'adult' | 'child' | 'infant' => {
  if (p.type === 'adult') return 'adult';
  if (p.type?.startsWith('infant') || (p.age != null && p.age < 2)) return 'infant';
  if (p.age != null && p.age < 18) return 'child';
  return p.type === 'child' ? 'child' : 'adult';
};

export function normalizeOffer(o: DuffelOffer): FlightOffer {
  const slices: FlightSlice[] = o.slices.map((s) => {
    const segments = s.segments.map((seg) => ({
      carrier: seg.marketing_carrier.iata_code ?? '??',
      carrierName: seg.marketing_carrier.name,
      flightNumber: `${seg.marketing_carrier.iata_code ?? ''}${seg.marketing_carrier_flight_number}`,
      ...(seg.operating_carrier.iata_code && seg.operating_carrier.iata_code !== seg.marketing_carrier.iata_code
        ? { operatedBy: seg.operating_carrier.name }
        : {}),
      origin: seg.origin.iata_code,
      destination: seg.destination.iata_code,
      departingAt: seg.departing_at,
      arrivingAt: seg.arriving_at,
      duration: seg.duration,
      ...(seg.aircraft?.name ? { aircraft: seg.aircraft.name } : {}),
    }));
    return {
      origin: s.origin.iata_code,
      destination: s.destination.iata_code,
      departingAt: segments[0]?.departingAt ?? '',
      arrivingAt: segments.at(-1)?.arrivingAt ?? '',
      duration: s.duration,
      stops: Math.max(0, segments.length - 1),
      segments,
    };
  });

  const firstSegPax = o.slices[0]?.segments[0]?.passengers?.[0];
  const bags = firstSegPax?.baggages ?? [];
  const cabin = firstSegPax?.cabin_class ?? 'economy';

  return {
    providerOfferId: o.id,
    owner: { code: o.owner.iata_code ?? '', name: o.owner.name, ...(o.owner.logo_symbol_url ? { logoUrl: o.owner.logo_symbol_url } : {}) },
    totalAmount: o.total_amount,
    currency: o.total_currency,
    ...(o.base_amount ? { baseAmount: o.base_amount } : {}),
    ...(o.tax_amount ? { taxAmount: o.tax_amount } : {}),
    expiresAt: o.expires_at,
    cabin,
    ...(o.slices[0]?.fare_brand_name ? { fareBrand: o.slices[0].fare_brand_name } : {}),
    slices,
    baggage: {
      checked: bags.filter((b) => b.type === 'checked').reduce((n, b) => n + b.quantity, 0),
      carryOn: bags.filter((b) => b.type === 'carry_on').reduce((n, b) => n + b.quantity, 0),
    },
    refundable: o.conditions?.refund_before_departure?.allowed ?? null,
    changeable: o.conditions?.change_before_departure?.allowed ?? null,
    passengers: o.passengers.map((p) => ({ providerPassengerId: p.id, type: paxType(p), ...(p.age != null ? { age: p.age } : {}) })),
    requiresInstantPayment: o.payment_requirements?.requires_instant_payment ?? true,
    itineraryKey: slices.map((s) => s.segments.map((g) => `${g.flightNumber}@${g.origin}${g.departingAt.slice(0, 16)}`).join('+')).join('|'),
  };
}
