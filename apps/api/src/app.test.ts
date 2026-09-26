// API tests: supertest sends real HTTP requests to the app in memory (no port) and
// we assert on status codes, headers and JSON, exactly as a client would see them.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { pool } from './db/pool.js';
import { signUp } from './test/auth.js';
import { resetDb } from './test/db.js';

const app = createApp();
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const validTrip = () => ({ origin: 'dxb', destination: 'LHR', departureDate: future(30), adults: 2, children: 1 });

type Agent = Awaited<ReturnType<typeof signUp>>['agent'];
let user: Agent;

beforeEach(async () => {
  await resetDb();
  user = (await signUp(app)).agent;
});
afterAll(() => pool.end());

describe('health and request IDs', () => {
  it('GET /health returns 200 and a request ID header', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('up');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reuses a well-formed incoming X-Request-Id', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'trace-abc-12345');
    expect(res.headers['x-request-id']).toBe('trace-abc-12345');
  });

  it('does not advertise Express', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('trips: happy path', () => {
  it('POST /trips creates a trip (201) and normalises input', async () => {
    const res = await user.post('/trips').send(validTrip());
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/trips/${res.body.data.id}`);
    expect(res.body.data).toMatchObject({ origin: 'DXB', destination: 'LHR', adults: 2, children: 1, cabin: 'economy' });
  });

  it('GET /trips/:id returns the created trip', async () => {
    const created = await user.post('/trips').send(validTrip());
    const res = await user.get(`/trips/${created.body.data.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(created.body.data.id);
  });

  it('GET /trips lists trips', async () => {
    await user.post('/trips').send(validTrip());
    const res = await user.get('/trips');
    expect(res.body.data).toHaveLength(1);
  });
});

describe('trips: failures', () => {
  it('400 with field errors when required fields are missing', async () => {
    const res = await user.post('/trips').send({ origin: 'DXB' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['destination', 'departureDate', 'adults']));
  });

  it('400 when origin equals destination', async () => {
    const res = await user.post('/trips').send({ ...validTrip(), destination: 'DXB' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('destination');
  });

  it('400 when departure date is in the past', async () => {
    const res = await user.post('/trips').send({ ...validTrip(), departureDate: '2020-01-01' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('departureDate');
  });

  it('400 MALFORMED_JSON for broken JSON', async () => {
    const res = await user.post('/trips').set('Content-Type', 'application/json').send('{"origin":"DXB",');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_JSON');
  });

  it('400 for a trip id that is not a UUID', async () => {
    const res = await user.get('/trips/123');
    expect(res.status).toBe(400);
  });

  it('404 for a trip that does not exist', async () => {
    const res = await user.get('/trips/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('404 for an unknown route', async () => {
    const res = await request(app).delete('/nope');
    expect(res.status).toBe(404);
  });

  it('500 for a bug, without leaking the internal message', async () => {
    const res = await request(app).get('/debug/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('Simulated bug');
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });
});
