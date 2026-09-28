// Test helper: empty the tables between tests so each test starts from a known state.
import { pool } from '../db/pool.js';

export async function resetDb() {
  await pool.query('TRUNCATE users, sessions, trips, passengers, flight_searches, offers, bookings, quotes, booking_attempts, booking_events, agent_conversations, agent_messages RESTART IDENTITY CASCADE');
}
