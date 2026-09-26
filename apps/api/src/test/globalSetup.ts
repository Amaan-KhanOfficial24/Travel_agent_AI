// Runs once before all tests: bring the test database schema up to date.
import pg from 'pg';

export default async function setup() {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL ?? 'postgres://app@localhost:5432/travel_test';
  const { migrate } = await import('../db/migrate.js');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
