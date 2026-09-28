// Authentication, authorization and web-security behaviour.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { signUp, TEST_PASSWORD } from '../test/auth.js';
import { resetDb } from '../test/db.js';

const app = createApp();
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const trip = { origin: 'DXB', destination: 'LHR', departureDate: future(30), adults: 1 };
const creds = { email: 'aman@example.com', password: TEST_PASSWORD };
const cookieOf = (res: request.Response) => ([] as string[]).concat(res.headers['set-cookie'] ?? []).join('; ');

beforeEach(() => resetDb());
afterAll(() => pool.end());

describe('registration', () => {
  it('creates an account, logs in, and sets a hardened session cookie', async () => {
    const res = await request(app).post('/auth/register').send(creds);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ email: 'aman@example.com', role: 'customer' });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    const cookie = cookieOf(res);
    expect(cookie).toMatch(/^sid=[A-Za-z0-9_-]{43};/); // 32 random bytes, base64url
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Expires=/);
  });

  it('stores an argon2id hash, never the password', async () => {
    await request(app).post('/auth/register').send(creds);
    const { rows } = await pool.query('SELECT password_hash FROM users');
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(rows[0].password_hash).not.toContain(creds.password);
  });

  it('stores only a hash of the session token', async () => {
    const res = await request(app).post('/auth/register').send(creds);
    const token = cookieOf(res).match(/sid=([^;]+)/)![1]!;
    const { rows } = await pool.query("SELECT encode(token_hash, 'hex') AS h FROM sessions");
    expect(rows[0].h).toHaveLength(64); // SHA-256
    expect(rows[0].h).not.toContain(Buffer.from(token).toString('hex'));
  });

  it('treats email case-insensitively: 409 for the same address in capitals', async () => {
    await request(app).post('/auth/register').send(creds);
    const res = await request(app).post('/auth/register').send({ ...creds, email: 'AMAN@Example.com' });
    expect(res.status).toBe(409);
  });

  it('400 for a short password or bad email', async () => {
    const res = await request(app).post('/auth/register').send({ email: 'not-an-email', password: 'x'.repeat(5) });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual(['email', 'password']);
  });
});

describe('login and logout', () => {
  beforeEach(async () => {
    await request(app).post('/auth/register').send(creds);
  });

  it('logs in with the right password', async () => {
    const res = await request(app).post('/auth/login').send(creds);
    expect(res.status).toBe(200);
    expect(cookieOf(res)).toMatch(/^sid=/);
  });

  it('same 401 message for a wrong password and an unknown email (no account enumeration)', async () => {
    const wrong = await request(app).post('/auth/login').send({ ...creds, password: TEST_PASSWORD + '-wrong' });
    const unknown = await request(app).post('/auth/login').send({ ...creds, email: 'nobody@example.com' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('logout deletes the session: the old cookie stops working immediately', async () => {
    const agent = request.agent(app);
    await agent.post('/auth/login').send(creds);
    expect((await agent.get('/auth/me')).status).toBe(200);
    const stolenCopy = cookieOf(await request(app).post('/auth/login').send(creds)); // a second session
    expect((await agent.post('/auth/logout')).status).toBe(204);
    expect((await agent.get('/auth/me')).status).toBe(401);
    // Logging out ends only that session; the other one is still valid.
    expect((await request(app).get('/auth/me').set('Cookie', stolenCopy)).status).toBe(200);
  });

  it('401 for an expired session', async () => {
    const agent = request.agent(app);
    await agent.post('/auth/login').send(creds);
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
    const res = await agent.get('/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('401 for a forged cookie', async () => {
    const res = await request(app).get('/auth/me').set('Cookie', 'sid=' + 'A'.repeat(43));
    expect(res.status).toBe(401);
  });
});

describe('authorization', () => {
  it('401 on trips without logging in', async () => {
    expect((await request(app).get('/trips')).status).toBe(401);
    expect((await request(app).post('/trips').send(trip)).status).toBe(401);
  });

  it("a user cannot see, change or delete someone else's trip (404, not 403)", async () => {
    const alice = await signUp(app);
    const bob = await signUp(app);
    const id = (await alice.agent.post('/trips').send(trip)).body.data.id;

    expect((await bob.agent.get(`/trips/${id}`)).status).toBe(404);
    expect((await bob.agent.get(`/trips/${id}/passengers`)).status).toBe(404);
    expect(
      (await bob.agent.post(`/trips/${id}/passengers`).send({ paxType: 'adult', givenName: 'B', familyName: 'B', bornOn: '1990-01-01' }))
        .status,
    ).toBe(404);
    expect((await bob.agent.delete(`/trips/${id}`)).status).toBe(404);
    expect((await bob.agent.get('/trips')).body.data).toHaveLength(0);

    expect((await alice.agent.get(`/trips/${id}`)).status).toBe(200); // still there, untouched
  });

  it('customers get 403 on admin routes; admins see every trip', async () => {
    const alice = await signUp(app);
    await alice.agent.post('/trips').send(trip);
    const admin = await signUp(app, { role: 'admin' });

    expect((await alice.agent.get('/admin/trips')).status).toBe(403);
    const all = await admin.agent.get('/admin/trips');
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(1);
    const users = await admin.agent.get('/admin/users');
    expect(JSON.stringify(users.body)).not.toMatch(/password|argon2/i);
  });
});

describe('web security', () => {
  it('blocks a state-changing request from a foreign website (CSRF)', async () => {
    const { agent } = await signUp(app);
    const res = await agent.post('/trips').set('Origin', 'https://evil.example').send(trip);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('Cross-site request blocked');
  });

  it('allows the same request from our own frontend origin', async () => {
    const { agent } = await signUp(app);
    expect((await agent.post('/trips').set('Origin', 'http://localhost:5173').send(trip)).status).toBe(201);
  });

  it('rejects a form-encoded body (what a hidden HTML form would send)', async () => {
    const { agent } = await signUp(app);
    const res = await agent.post('/trips').type('form').send('origin=DXB&destination=LHR');
    expect(res.status).toBe(415);
  });

  it('CORS: our frontend may read responses, other sites may not', async () => {
    const ours = await request(app).options('/trips').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST');
    expect(ours.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(ours.headers['access-control-allow-credentials']).toBe('true');
    const evil = await request(app).options('/trips').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sends security headers', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('stores HTML/script input as plain text and returns it as JSON, never as a page', async () => {
    const { agent } = await signUp(app);
    const id = (await agent.post('/trips').send(trip)).body.data.id;
    const xss = '<script>alert(1)</script>';
    const res = await agent.post(`/trips/${id}/passengers`).send({ paxType: 'adult', givenName: xss, familyName: 'K', bornOn: '1990-01-01' });
    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body.data.givenName).toBe(xss); // stored as-is; the frontend must render it as text
  });
});
