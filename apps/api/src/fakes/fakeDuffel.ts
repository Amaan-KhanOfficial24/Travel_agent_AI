// A stand-in for the Duffel API, for automated tests and offline demos. It speaks the same
// HTTP/JSON format as api.duffel.com (Duffel-Version v2) and reproduces Duffel test-mode's
// documented scenario routes (https://duffel.com/docs/api/overview/test-your-integration):
//
//   PVD → RAI  no offers              LGW → LHR  offer no longer available when refreshed
//   LHR → STN  price rises on refresh LHR → LGW  order creation fails (airline error)
//   LGW → STN  insufficient balance   LTN → STN / SEN → STN  order accepted (202), confirmed later
//   LCY → STN  order accepted (202), then never created
//   anything else: normal offers from "Duffel Airways" (ZZ)
//
// Extra routes that only exist here, to exercise recovery AFTER the customer agreed a price:
//   LHR → GLA  price rises 10% on the 2nd refresh     LHR → MAN  price rises 40% on the 2nd refresh
//   LHR → EDI  first order fails with price_changed   LHR → BHX  every order fails with price_changed
//
// The real app never uses this unless DUFFEL_BASE_URL points at it.
import { randomUUID } from 'node:crypto';
import express from 'express';

type Offer = Record<string, any>;

const ids = (p: string) => `${p}_${randomUUID().replace(/-/g, '').slice(0, 22)}`;
const pad = (n: number) => String(n).padStart(2, '0');

function place(code: string) {
  return { iata_code: code, name: `${code} Airport`, city_name: code, time_zone: 'UTC', type: 'airport' };
}

function makeOffer(req: any, variant: number, route: string): Offer {
  const passengers = (req.passengers as any[]).map((p) => ({ id: ids('pas'), type: p.type ?? null, age: p.age ?? null }));
  const base = 300 + (route.charCodeAt(0) + route.charCodeAt(4)) % 200;
  const perPax = base + variant * 85;
  const total = passengers.reduce((sum, p) => sum + (p.age != null && p.age < 12 ? perPax * 0.75 : perPax), 0);
  const stops = variant === 2 ? 1 : 0;
  const slices = (req.slices as any[]).map((s, si) => {
    const depHour = 8 + variant * 2 + si;
    const dep = `${s.departure_date}T${pad(depHour)}:${variant === 1 ? '30' : '00'}:00`;
    const legs = stops ? [[s.origin, 'MCT'], ['MCT', s.destination]] : [[s.origin, s.destination]];
    const segments = legs.map(([o, d], li) => ({
      id: ids('seg'),
      origin: place(o!),
      destination: place(d!),
      departing_at: li === 0 ? dep : `${s.departure_date}T${pad(depHour + 3)}:15:00`,
      arriving_at: `${s.departure_date}T${pad(depHour + 2 + li * 3)}:${li ? '45' : '10'}:00`,
      duration: 'PT2H10M',
      marketing_carrier: { iata_code: 'ZZ', name: 'Duffel Airways', logo_symbol_url: null },
      marketing_carrier_flight_number: String(100 + variant * 10 + si * 2 + li),
      operating_carrier: { iata_code: 'ZZ', name: 'Duffel Airways' },
      aircraft: { name: 'Airbus A320' },
      passengers: passengers.map((p) => ({
        passenger_id: p.id,
        cabin_class: req.cabin_class ?? 'economy',
        cabin_class_marketing_name: 'Economy',
        baggages: [{ type: 'checked', quantity: variant === 0 ? 0 : 1 }, { type: 'carry_on', quantity: 1 }],
      })),
    }));
    return { id: ids('sli'), origin: place(s.origin), destination: place(s.destination), duration: stops ? 'PT5H45M' : 'PT2H10M', fare_brand_name: variant === 0 ? 'Basic' : 'Standard', segments };
  });
  return {
    id: ids('off'),
    total_amount: total.toFixed(2),
    total_currency: 'USD',
    base_amount: (total * 0.8).toFixed(2),
    tax_amount: (total * 0.2).toFixed(2),
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    owner: { iata_code: 'ZZ', name: 'Duffel Airways' },
    slices,
    passengers,
    payment_requirements: { requires_instant_payment: true },
    conditions: { refund_before_departure: { allowed: variant > 0 }, change_before_departure: { allowed: true } },
    _route: route,
  };
}

const err = (res: express.Response, status: number, type: string, code: string, message: string) =>
  res.status(status).json({ errors: [{ type, code, title: code, message }], meta: { status, request_id: ids('req') } });

export function createFakeDuffel() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  const offers = new Map<string, Offer>();
  const orders = new Map<string, Record<string, any>>();
  const repriced = new Set<string>();
  const getCount = new Map<string, number>();
  const failedOnce = new Set<string>();

  app.use((req, res, next) => {
    if (!req.get('authorization')?.startsWith('Bearer ')) return err(res, 401, 'authentication_error', 'missing_authorization_header', 'Missing token');
    if (req.get('duffel-version') !== 'v2') return err(res, 400, 'invalid_request_error', 'unsupported_version', 'Duffel-Version must be v2');
    next();
  });

  app.post('/air/offer_requests', (req, res) => {
    const data = req.body?.data;
    if (!data?.slices?.length || !data?.passengers?.length) return err(res, 422, 'validation_error', 'validation_required', 'slices and passengers are required');
    const first = data.slices[0];
    const route = `${first.origin}-${first.destination}`;
    if (route === 'PVD-RAI') return res.status(201).json({ data: { id: ids('orq'), offers: [] } });
    if (route === 'STN-LHR') return err(res, 504, 'airline_error', 'airline_timeout', 'The airline did not respond in time');
    let list = [0, 1, 2].map((v) => makeOffer(data, v, route));
    if (data.max_connections === 0) list = list.filter((o) => o.slices.every((s: any) => s.segments.length === 1));
    for (const o of list) offers.set(o.id, o);
    res.status(201).json({ data: { id: ids('orq'), offers: list.map(({ _route, ...o }) => o) } });
  });

  app.get('/air/offers/:id', (req, res) => {
    const o = offers.get(req.params.id);
    if (!o || Date.parse(o.expires_at) < Date.now()) return err(res, 404, 'invalid_request_error', 'not_found', 'Offer not found');
    if (o._route === 'LGW-LHR') return err(res, 422, 'invalid_state_error', 'offer_no_longer_available', 'The provided offer is no longer available');
    if (o._route === 'LHR-STN' && !repriced.has(o.id)) {
      repriced.add(o.id);
      o.total_amount = (Number(o.total_amount) * 1.15).toFixed(2);
    }
    const n = (getCount.get(o.id) ?? 0) + 1;
    getCount.set(o.id, n);
    if (n === 2 && o._route === 'LHR-GLA') o.total_amount = (Number(o.total_amount) * 1.1).toFixed(2);
    if (n === 2 && o._route === 'LHR-MAN') o.total_amount = (Number(o.total_amount) * 1.4).toFixed(2);
    const { _route, ...out } = o;
    res.json({ data: out });
  });

  app.post('/air/orders', (req, res) => {
    const d = req.body?.data;
    const o = offers.get(d?.selected_offers?.[0]);
    if (!o) return err(res, 422, 'invalid_state_error', 'offer_no_longer_available', 'The provided offer is no longer available');
    const pay = d.payments?.[0];
    if (!pay || pay.type !== 'balance') return err(res, 422, 'validation_error', 'validation_required', 'payments[0] must be a balance payment');
    if (pay.amount !== o.total_amount || pay.currency !== o.total_currency) {
      return err(res, 422, 'invalid_state_error', 'price_changed', 'The provided offer is no longer available for the same price');
    }
    const offerPax = new Set(o.passengers.map((p: any) => p.id));
    for (const p of d.passengers ?? []) {
      for (const f of ['id', 'title', 'gender', 'given_name', 'family_name', 'born_on', 'email', 'phone_number']) {
        if (!p[f]) return err(res, 422, 'validation_error', 'validation_required', `passengers.${f} is required`);
      }
      if (!offerPax.has(p.id)) return err(res, 422, 'validation_error', 'invalid_passenger', `Unknown passenger id ${p.id}`);
      if (!/^\+[1-9]\d{7,14}$/.test(p.phone_number)) return err(res, 422, 'validation_error', 'invalid_phone_number', 'Phone number must be in E.164 format');
      if (!/^[A-Za-z' -]+$/.test(p.given_name + p.family_name)) return err(res, 422, 'validation_error', 'invalid_passenger_name', 'The passenger name format is not valid');
    }
    if ((d.passengers ?? []).length !== o.passengers.length) return err(res, 422, 'validation_error', 'validation_required', 'All offer passengers must be provided');

    const route = o._route;
    if (route === 'LHR-BHX' || (route === 'LHR-EDI' && !failedOnce.has(route))) {
      failedOnce.add(route);
      return err(res, 422, 'invalid_state_error', 'price_changed', 'The provided offer is no longer available for the same price');
    }
    if (route === 'LHR-LGW') return err(res, 400, 'airline_error', 'airline_internal', 'The airline could not create this order');
    if (route === 'LGW-STN') return err(res, 422, 'invalid_state_error', 'insufficient_balance', 'Your balance is too low for this order');

    const order = {
      id: ids('ord'),
      booking_reference: Math.random().toString(36).slice(2, 8).toUpperCase(),
      total_amount: o.total_amount,
      total_currency: o.total_currency,
      documents: d.passengers.map((p: any) => ({ type: 'electronic_ticket', unique_identifier: `1${Math.floor(1e12 + Math.random() * 9e12)}`, passenger_ids: [p.id] })),
      passengers: d.passengers.map((p: any) => ({ id: p.id, given_name: p.given_name, family_name: p.family_name })),
      metadata: d.metadata ?? null,
      created_at: new Date().toISOString(),
    };
    offers.delete(o.id); // an offer can be booked once
    if (route === 'LCY-STN') return res.status(202).json({ data: null });
    orders.set(order.id, order);
    if (route === 'LTN-STN' || route === 'SEN-STN') return res.status(202).json({ data: null });
    res.status(201).json({ data: order });
  });

  app.get('/air/orders/:id', (req, res) => {
    const o = orders.get(req.params.id);
    return o ? res.json({ data: o }) : err(res, 404, 'invalid_request_error', 'not_found', 'Order not found');
  });
  app.get('/air/orders', (_req, res) => res.json({ data: [...orders.values()].reverse().slice(0, 50), meta: { limit: 50 } }));

  return app;
}
