// The shapes the API returns. (Later these could be generated from the API's zod
// schemas so frontend and backend can never disagree; for now they are written by hand.)

export type User = { id: string; email: string; role: 'customer' | 'admin'; createdAt: string };

export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first';
export type PaxType = 'adult' | 'child' | 'infant';

export type Passenger = {
  id: string;
  tripId: string;
  paxType: PaxType;
  title?: 'mr' | 'ms' | 'mrs' | 'miss' | 'dr';
  givenName: string;
  familyName: string;
  bornOn: string;
  gender?: 'm' | 'f';
};

export type Trip = {
  id: string;
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  adults: number;
  children: number;
  cabin: Cabin;
  createdAt: string;
  passengers?: Passenger[];
};

export type NewTrip = Pick<Trip, 'origin' | 'destination' | 'departureDate' | 'adults' | 'children' | 'cabin'> & {
  returnDate?: string;
  passengers?: (NewPassenger & { title?: string; gender?: string })[];
};
export type NewPassenger = Omit<Passenger, 'id' | 'tripId'>;

// ---------- flights, quotes, bookings, assistant ----------

export type FlightSegment = { carrier: string; carrierName: string; flightNumber: string; operatedBy?: string; origin: string; destination: string; departingAt: string; arrivingAt: string; duration: string | null; aircraft?: string };
export type FlightSlice = { origin: string; destination: string; departingAt: string; arrivingAt: string; duration: string | null; stops: number; segments: FlightSegment[] };
export type Offer = {
  id: string;
  searchId: string;
  owner: { code: string; name: string; logoUrl?: string };
  totalAmount: string;
  currency: string;
  expiresAt: string;
  cabin: string;
  fareBrand?: string;
  slices: FlightSlice[];
  baggage: { checked: number; carryOn: number };
  refundable: boolean | null;
  changeable: boolean | null;
  passengers: { providerPassengerId: string; type: 'adult' | 'child' | 'infant'; age?: number }[];
};
export type SearchResult = { searchId: string; totalFound: number; offers: Offer[] };
export type Quote = {
  id: string;
  status: 'SAME_PRICE' | 'PRICE_CHANGED' | 'ALTERNATIVE';
  matchTier: 'EXACT' | 'SAME_FLIGHTS_NEW_FARE' | 'EQUIVALENT';
  offer: Offer;
  referenceAmount: string;
  totalAmount: string;
  currency: string;
  difference: string;
  expiresAt: string;
};
export type PriceCheck = { available: true; quote: Quote } | { available: false; alternatives: Quote[] };

export type BookingState = 'REPRICING' | 'ORDERING' | 'CONFIRMING' | 'TICKETED' | 'RECOVERY' | 'AWAITING_APPROVAL' | 'CANCELLED' | 'FAILED' | 'NEEDS_ATTENTION';
export type Booking = {
  id: string;
  tripId: string;
  state: BookingState;
  attemptCount: number;
  originalAmount: string;
  paidAmount: string | null;
  currency: string;
  pnr: string | null;
  tickets: { number: string; passengerId?: string }[];
  failureReason: string | null;
  contact: { email: string; phone: string };
  passengers: Passenger[];
  offer: Offer | null;
  pendingApproval: { quote: Quote; difference: string } | null;
  events: { from: string | null; to: string | null; event: string; detail: Record<string, unknown>; at: string }[];
  createdAt: string;
};
export type BookingSummary = { id: string; state: BookingState; pnr: string | null; originalAmount: string; paidAmount: string | null; currency: string; createdAt: string; origin: string; destination: string; departureDate: string };
export type Card = { type: 'offers'; searchId: string; offers: Offer[] } | { type: 'quote'; quote: Quote } | { type: 'alternatives'; quotes: Quote[] };
export type ChatReply = { conversationId: string; reply: string; cards: Card[] };
