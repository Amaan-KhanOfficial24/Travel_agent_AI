// Data access with plain SQL. Every value goes in as a numbered parameter ($1, $2 ...),
// never pasted into the SQL string: the driver sends SQL and values separately, so a
// value like "x'); DROP TABLE trips;--" is stored as text, not executed (no SQL injection).
import type pg from 'pg';
import { pool } from '../db/pool.js';
import type { CreateTripInput, Passenger, PassengerInput, Trip } from './trips.schema.js';

// Anything with a .query() method: the pool (one-off queries) or a client inside a transaction.
type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

// Whose trips a query may see: one user's, or (admin) everyone's.
// Ownership is enforced IN the SQL (WHERE user_id = ...), so no code path can forget it.
export type Scope = { userId: string } | { all: true };
const owner = (scope: Scope) => ('userId' in scope ? scope.userId : null); // null = no filter

type TripRow = {
  id: string; user_id: string | null; origin: string; destination: string; departure_date: string; return_date: string | null;
  adults: number; children: number; cabin: Trip['cabin']; created_at: Date;
};
type PassengerRow = {
  id: string; trip_id: string; pax_type: Passenger['paxType']; title: Passenger['title'] | null;
  given_name: string; family_name: string; born_on: string; gender: 'm' | 'f' | null; created_at: Date;
};

// Database columns are snake_case; the API speaks camelCase. Mapping happens here only.
const toTrip = (r: TripRow): Trip => ({
  id: r.id,
  userId: r.user_id,
  origin: r.origin,
  destination: r.destination,
  departureDate: r.departure_date,
  ...(r.return_date ? { returnDate: r.return_date } : {}),
  adults: r.adults,
  children: r.children,
  cabin: r.cabin,
  createdAt: r.created_at.toISOString(),
});

const toPassenger = (r: PassengerRow): Passenger => ({
  id: r.id,
  tripId: r.trip_id,
  paxType: r.pax_type,
  ...(r.title ? { title: r.title } : {}),
  givenName: r.given_name,
  familyName: r.family_name,
  bornOn: r.born_on,
  ...(r.gender ? { gender: r.gender } : {}),
  createdAt: r.created_at.toISOString(),
});

export const tripsRepository = {
  async create(input: Omit<CreateTripInput, 'passengers'>, userId: string, db: Queryable = pool): Promise<Trip> {
    const { rows } = await db.query<TripRow>(
      `INSERT INTO trips (user_id, origin, destination, departure_date, return_date, adults, children, cabin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [userId, input.origin, input.destination, input.departureDate, input.returnDate ?? null,
       input.adults, input.children, input.cabin],
    );
    return toTrip(rows[0]!);
  },

  async findById(id: string, scope: Scope, db: Queryable = pool): Promise<Trip | undefined> {
    const { rows } = await db.query<TripRow>(
      'SELECT * FROM trips WHERE id = $1 AND ($2::uuid IS NULL OR user_id = $2)',
      [id, owner(scope)],
    );
    return rows[0] ? toTrip(rows[0]) : undefined;
  },

  /** Locks the trip row until the transaction ends (see tripsService.addPassenger). */
  async findByIdForUpdate(id: string, scope: Scope, db: Queryable): Promise<Trip | undefined> {
    const { rows } = await db.query<TripRow>(
      'SELECT * FROM trips WHERE id = $1 AND ($2::uuid IS NULL OR user_id = $2) FOR UPDATE',
      [id, owner(scope)],
    );
    return rows[0] ? toTrip(rows[0]) : undefined;
  },

  async list(scope: Scope, limit = 50, db: Queryable = pool): Promise<Trip[]> {
    const { rows } = await db.query<TripRow>(
      `SELECT * FROM trips WHERE ($1::uuid IS NULL OR user_id = $1)
       ORDER BY created_at DESC LIMIT $2`,
      [owner(scope), limit],
    );
    return rows.map(toTrip);
  },

  /** Returns true if a row was deleted. Passengers go with it (ON DELETE CASCADE). */
  async delete(id: string, scope: Scope, db: Queryable = pool): Promise<boolean> {
    const { rowCount } = await db.query('DELETE FROM trips WHERE id = $1 AND ($2::uuid IS NULL OR user_id = $2)', [
      id,
      owner(scope),
    ]);
    return rowCount === 1;
  },

  async addPassenger(tripId: string, p: PassengerInput, db: Queryable = pool): Promise<Passenger> {
    const { rows } = await db.query<PassengerRow>(
      `INSERT INTO passengers (trip_id, pax_type, title, given_name, family_name, born_on, gender)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [tripId, p.paxType, p.title ?? null, p.givenName, p.familyName, p.bornOn, p.gender ?? null],
    );
    return toPassenger(rows[0]!);
  },

  async listPassengers(tripId: string, db: Queryable = pool): Promise<Passenger[]> {
    const { rows } = await db.query<PassengerRow>(
      'SELECT * FROM passengers WHERE trip_id = $1 ORDER BY created_at, id',
      [tripId],
    );
    return rows.map(toPassenger);
  },

  /** Fill in title/gender collected at booking time. */
  async updateBookingDetails(id: string, d: { title: string; gender: string }, db: Queryable = pool): Promise<void> {
    await db.query('UPDATE passengers SET title = $2, gender = $3 WHERE id = $1', [id, d.title, d.gender]);
  },
};
