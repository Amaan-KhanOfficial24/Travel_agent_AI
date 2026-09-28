// Runs once before all tests: bring the test database schema up to date.
import type { Server } from 'node:http';
import pg from 'pg';
import { createFakeDuffel } from '../fakes/fakeDuffel.js';
import { createFakeGemini } from '../fakes/fakeGemini.js';

export default async function setup() {
  const servers: Server[] = await Promise.all([
    new Promise<Server>((r) => { const s = createFakeDuffel().listen(4010, () => r(s)); }),
    new Promise<Server>((r) => { const s = createFakeGemini().listen(4020, () => r(s)); }),
  ]);
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL ?? 'postgres://app@localhost:5432/travel_test';
  const { migrate } = await import('../db/migrate.js');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await migrate(pool);
  } catch (err) {
    servers.forEach((s) => s.close());
    throw err;
  } finally {
    await pool.end();
  }
  return () => servers.forEach((s) => s.close());
}
