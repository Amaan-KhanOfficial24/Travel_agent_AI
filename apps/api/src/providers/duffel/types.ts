// The parts of Duffel's API responses we use (Duffel-Version: v2).
// Reference: https://duffel.com/docs/api/v2/offers/schema

export type DuffelPlace = { iata_code: string; name?: string; city_name?: string | null; time_zone?: string };
export type DuffelCarrier = { iata_code: string | null; name: string; logo_symbol_url?: string | null };

export type DuffelSegment = {
  id: string;
  origin: DuffelPlace;
  destination: DuffelPlace;
  departing_at: string; // local time at origin, no offset: "2026-12-15T09:40:00"
  arriving_at: string;
  duration: string | null; // ISO 8601, e.g. "PT7H30M"
  marketing_carrier: DuffelCarrier;
  marketing_carrier_flight_number: string;
  operating_carrier: DuffelCarrier;
  operating_carrier_flight_number?: string | null;
  aircraft?: { name: string } | null;
  passengers?: {
    passenger_id: string;
    cabin_class?: string;
    cabin_class_marketing_name?: string;
    baggages?: { type: 'checked' | 'carry_on'; quantity: number }[];
  }[];
};

export type DuffelSlice = {
  id: string;
  origin: DuffelPlace;
  destination: DuffelPlace;
  duration: string | null;
  fare_brand_name?: string | null;
  segments: DuffelSegment[];
};

export type DuffelOfferPassenger = { id: string; type?: string | null; age?: number | null };

export type DuffelOffer = {
  id: string;
  total_amount: string;
  total_currency: string;
  base_amount?: string | null;
  tax_amount?: string | null;
  expires_at: string;
  owner: DuffelCarrier;
  slices: DuffelSlice[];
  passengers: DuffelOfferPassenger[];
  payment_requirements?: { requires_instant_payment: boolean; payment_required_by?: string | null } | null;
  conditions?: {
    refund_before_departure?: { allowed: boolean; penalty_amount?: string | null; penalty_currency?: string | null } | null;
    change_before_departure?: { allowed: boolean; penalty_amount?: string | null; penalty_currency?: string | null } | null;
  } | null;
};

export type DuffelOfferRequest = { id: string; offers: DuffelOffer[] };

export type DuffelOrder = {
  id: string;
  booking_reference: string;
  total_amount: string;
  total_currency: string;
  documents?: { type: string; unique_identifier: string; passenger_ids?: string[] }[];
  passengers?: { id: string; given_name: string; family_name: string }[];
  metadata?: Record<string, string> | null;
  created_at?: string;
};

export type DuffelErrorBody = {
  errors?: { code?: string; type?: string; title?: string; message?: string }[];
  meta?: { request_id?: string; status?: number };
};
