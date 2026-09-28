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
};
export type NewPassenger = Omit<Passenger, 'id' | 'tripId'>;
