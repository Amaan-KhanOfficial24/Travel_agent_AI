// Test helper: a supertest "agent" is like a browser tab. It keeps the cookies it
// receives and sends them on every later request, so after signUp() it is logged in.
import type { Express } from 'express';
import request from 'supertest';
import { pool } from '../db/pool.js';

// Fake password for throwaway test accounts in the test database. Not a credential.
export const TEST_PASSWORD = 'test-only-password-123'; // pragma: allowlist secret  gitleaks:allow

let counter = 0;

export async function signUp(app: Express, opts: { role?: 'customer' | 'admin'; email?: string } = {}) {
  const agent = request.agent(app);
  const email = opts.email ?? `user${++counter}-${Date.now()}@example.com`;
  const res = await agent.post('/auth/register').send({ email, password: TEST_PASSWORD });
  if (res.status !== 201) throw new Error(`signUp failed: ${res.status} ${JSON.stringify(res.body)}`);
  if (opts.role === 'admin') await pool.query("UPDATE users SET role = 'admin' WHERE email = $1", [email]);
  return { agent, email, userId: res.body.data.id as string };
}
