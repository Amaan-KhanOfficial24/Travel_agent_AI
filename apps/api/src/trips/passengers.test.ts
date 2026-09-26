// Database behaviour: passengers, transactions, constraints and concurrent writes,
// tested against a real PostgreSQL test database.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { signUp } from '../test/auth.js';
import { resetDb } from '../test/db.js';

const app = createApp();
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const adult = (givenName = 'Aman') => ({ paxType: 'adult', givenName, familyName: 'Khan', bornOn: '1995-04-10' });
const child = { paxType: 'child', givenName: 'Sara', familyName: 'Khan', bornOn: '2018-06-01' };
const trip = (extra = {}) => ({ origin: 'DXB', destination: 'LHR', departureDate: future(30), adults: 2, children: 1, ...extra });

async function createTrip(extra = {}) {
  const res = await user.post('/trips').send(trip(extra));
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

type Agent = Awaited<ReturnType<typeof signUp>>['agent'];
let user: Agent;

beforeEach(async () => {
  await resetDb();
  user = (await signUp(app)).agent;
});
afterAll(() => pool.end());

describe('persistence', () => {
  it('a trip is really stored in PostgreSQL', async () => {
    const id = await createTrip();
    const { rows } = await pool.query('SELECT origin, destination, adults FROM trips WHERE id = $1', [id]);
    expect(rows[0]).toEqual({ origin: 'DXB', destination: 'LHR', adults: 2 });
  });

  it('dates come back exactly as sent (no time-zone shift)', async () => {
    const id = await createTrip({ departureDate: '2027-01-01', returnDate: '2027-01-15' });
    const res = await user.get(`/trips/${id}`);
    expect(res.body.data).toMatchObject({ departureDate: '2027-01-01', returnDate: '2027-01-15' });
  });

  it('DELETE removes the trip and its passengers (cascade)', async () => {
    const id = await createTrip();
    await user.post(`/trips/${id}/passengers`).send(adult());
    expect((await user.delete(`/trips/${id}`)).status).toBe(204);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM passengers WHERE trip_id = $1', [id]);
    expect(rows[0].n).toBe(0);
    expect((await user.get(`/trips/${id}`)).status).toBe(404);
  });
});

describe('passengers', () => {
  it('adds and lists passengers', async () => {
    const id = await createTrip();
    const add = await user.post(`/trips/${id}/passengers`).send(adult());
    expect(add.status).toBe(201);
    expect(add.body.data).toMatchObject({ tripId: id, paxType: 'adult', givenName: 'Aman' });
    const list = await user.get(`/trips/${id}/passengers`);
    expect(list.body.data).toHaveLength(1);
  });

  it('409 when the same person is added twice (unique constraint)', async () => {
    const id = await createTrip();
    await user.post(`/trips/${id}/passengers`).send(adult());
    const res = await user.post(`/trips/${id}/passengers`).send(adult());
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('This passenger is already on the trip');
  });

  it('400 when there are more adults than the trip allows', async () => {
    const id = await createTrip({ adults: 1, children: 0 });
    await user.post(`/trips/${id}/passengers`).send(adult('One'));
    const res = await user.post(`/trips/${id}/passengers`).send(adult('Two'));
    expect(res.status).toBe(400);
  });

  it('404 when adding a passenger to a trip that does not exist', async () => {
    const res = await user.post('/trips/00000000-0000-4000-8000-000000000000/passengers').send(adult());
    expect(res.status).toBe(404);
  });
});

describe('transactions', () => {
  it('creates a trip with passengers in one request', async () => {
    const res = await user.post('/trips').send(trip({ passengers: [adult(), child] }));
    expect(res.status).toBe(201);
    expect(res.body.data.passengers).toHaveLength(2);
  });

  it('rolls back the trip when a passenger insert fails', async () => {
    // Same person twice: the second insert violates the unique constraint inside the
    // transaction, so the already-inserted trip must be rolled back as well.
    const res = await user.post('/trips').send(trip({ passengers: [adult(), adult()] }));
    expect(res.status).toBe(409);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM trips');
    expect(rows[0].n).toBe(0);
  });
});

describe('concurrency', () => {
  it('waits for a competing transaction instead of overbooking (row lock)', async () => {
    // Timing-based race tests are unreliable, so force the overlap deterministically:
    // a second connection locks the trip row and takes the last seat, and while it
    // holds the lock the API is asked to add another adult.
    const id = await createTrip({ adults: 1, children: 0 });
    const other = await pool.connect();
    try {
      await other.query('BEGIN');
      await other.query('SELECT 1 FROM trips WHERE id = $1 FOR UPDATE', [id]);
      await other.query(
        `INSERT INTO passengers (trip_id, pax_type, given_name, family_name, born_on)
         VALUES ($1, 'adult', 'Competing', 'Booker', '1990-01-01')`,
        [id],
      );

      let finished = false;
      const apiCall = user
        .post(`/trips/${id}/passengers`)
        .send(adult('Late'))
        .then((r) => ((finished = true), r));

      await new Promise((r) => setTimeout(r, 300));
      expect(finished).toBe(false); // the API is blocked on the lock, not racing ahead

      await other.query('COMMIT'); // release: the API now sees the committed seat
      const res = await apiCall;
      expect(res.status).toBe(400);
    } finally {
      other.release();
    }
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM passengers WHERE trip_id = $1', [id]);
    expect(rows[0].n).toBe(1);
  });
});

describe('database constraints are the last line of defence', () => {
  it('rejects an invalid row even when written directly, bypassing the API', async () => {
    await expect(
      pool.query(`INSERT INTO trips (origin, destination, departure_date, adults) VALUES ('DXB', 'DXB', '2027-01-01', 1)`),
    ).rejects.toMatchObject({ code: '23514', constraint: 'trips_origin_differs' });
  });

  it('treats a malicious value as plain text (parameterised queries)', async () => {
    const id = await createTrip();
    const evil = "x'); DROP TABLE trips; --";
    const res = await user.post(`/trips/${id}/passengers`).send({ ...adult(), familyName: evil });
    expect(res.status).toBe(201);
    expect(res.body.data.familyName).toBe(evil);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM trips');
    expect(rows[0].n).toBe(1); // table still exists
  });
});
