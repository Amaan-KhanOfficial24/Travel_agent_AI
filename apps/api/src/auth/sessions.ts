// Server-side sessions. On login we create a random 256-bit token, give it to the
// browser in a cookie, and store only its SHA-256 hash. Each request sends the cookie
// back; we hash it and look the session up. Logout deletes the row, which instantly
// invalidates the cookie everywhere (something a stateless JWT cannot do).
import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import { config } from '../config.js';
import { pool } from '../db/pool.js';

export const SESSION_COOKIE = 'sid';

export type SessionUser = { id: string; email: string; role: 'customer' | 'admin'; sessionId: string };

const sha256 = (token: string) => createHash('sha256').update(token).digest();
const ttlMs = () => config.SESSION_TTL_HOURS * 3_600_000;

export async function createSession(userId: string, userAgent?: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url'); // 256 bits: unguessable
  const expiresAt = new Date(Date.now() + ttlMs());
  await pool.query(
    'INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES ($1, $2, $3, $4)',
    [sha256(token), userId, expiresAt, userAgent?.slice(0, 200) ?? null],
  );
  return { token, expiresAt };
}

/** Returns the user for a valid, unexpired token; slides the expiry forward when half used. */
export async function findSession(token: string): Promise<SessionUser | undefined> {
  const { rows } = await pool.query<{
    session_id: string; expires_at: Date; id: string; email: string; role: SessionUser['role'];
  }>(
    `SELECT s.id AS session_id, s.expires_at, u.id, u.email, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  const row = rows[0];
  if (!row) return undefined;

  // Sliding expiry: an active user stays logged in; an idle one is logged out after the TTL.
  if (row.expires_at.getTime() - Date.now() < ttlMs() / 2) {
    await pool.query('UPDATE sessions SET expires_at = $2, last_seen_at = now() WHERE id = $1', [
      row.session_id,
      new Date(Date.now() + ttlMs()),
    ]);
  }
  return { id: row.id, email: row.email, role: row.role, sessionId: row.session_id };
}

export async function deleteSession(sessionId: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

/** Housekeeping: remove expired sessions (called on login). */
export async function deleteExpiredSessions(): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
}

export function cookieOptions(expires?: Date): CookieOptions {
  return {
    httpOnly: true, // JavaScript in the page cannot read it, so an XSS bug cannot steal it
    secure: config.NODE_ENV === 'production' || config.COOKIE_SAMESITE === 'none', // HTTPS only
    sameSite: config.COOKIE_SAMESITE, // not sent on cross-site POSTs (CSRF defence, layer 1)
    path: '/',
    ...(expires ? { expires } : {}),
  };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}
