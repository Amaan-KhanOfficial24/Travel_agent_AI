// Account logic: register, log in, log out. No HTTP here.
import { pool } from '../db/pool.js';
import { conflict, unauthorized } from '../errors.js';
import { burnHashTime, hashPassword, verifyPassword } from './password.js';
import { createSession, deleteExpiredSessions, deleteSession } from './sessions.js';

type PublicUser = { id: string; email: string; role: 'customer' | 'admin'; createdAt: string };

const toPublic = (r: { id: string; email: string; role: PublicUser['role']; created_at: Date }): PublicUser => ({
  id: r.id,
  email: r.email,
  role: r.role,
  createdAt: r.created_at.toISOString(),
});

export const authService = {
  async register(email: string, password: string, userAgent?: string) {
    const passwordHash = await hashPassword(password);
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2)
         RETURNING id, email, role, created_at`,
        [email, passwordHash],
      );
      const user = toPublic(rows[0]);
      return { user, session: await createSession(user.id, userAgent) };
    } catch (err) {
      // The UNIQUE constraint is the real duplicate check: two simultaneous sign-ups
      // with the same email cannot both succeed, which a "SELECT first" check can't promise.
      if ((err as { code?: string }).code === '23505') throw conflict('An account with this email already exists');
      throw err;
    }
  },

  async login(email: string, password: string, userAgent?: string) {
    const { rows } = await pool.query('SELECT id, email, role, created_at, password_hash FROM users WHERE email = $1', [
      email,
    ]);
    const row = rows[0];
    if (!row) {
      await burnHashTime(password); // same timing as a wrong password
      throw unauthorized('Invalid email or password'); // same message too: no "user not found"
    }
    if (!(await verifyPassword(row.password_hash, password))) throw unauthorized('Invalid email or password');

    await deleteExpiredSessions();
    return { user: toPublic(row), session: await createSession(row.id, userAgent) };
  },

  logout: (sessionId: string) => deleteSession(sessionId),

  async me(userId: string): Promise<PublicUser> {
    const { rows } = await pool.query('SELECT id, email, role, created_at FROM users WHERE id = $1', [userId]);
    if (!rows[0]) throw unauthorized();
    return toPublic(rows[0]);
  },
};
