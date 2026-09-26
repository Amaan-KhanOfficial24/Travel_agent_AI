// Test helper: empty the tables between tests so each test starts from a known state.
import { pool } from '../db/pool.js';

export async function resetDb() {
  await pool.query('TRUNCATE trips, passengers RESTART IDENTITY CASCADE');
}
