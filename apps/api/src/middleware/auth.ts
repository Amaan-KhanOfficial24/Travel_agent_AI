// Authentication (who are you?) and authorization (may you do this?).
import type { RequestHandler } from 'express';
import { findSession, SESSION_COOKIE, type SessionUser } from '../auth/sessions.js';
import { forbidden, unauthorized } from '../errors.js';

/** Runs on every request: if a valid session cookie is present, attach req.user. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string' && token.length > 0 && token.length < 100) {
    req.user = await findSession(token);
    if (req.user) req.log = req.log.child({ userId: req.user.id }); // every log line knows the user
  }
  next();
};

/** Route guard: 401 unless logged in. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  next(req.user ? undefined : unauthorized());
};

/** Route guard: 403 unless the logged-in user has one of the roles. */
export const requireRole =
  (...roles: SessionUser['role'][]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    next(roles.includes(req.user.role) ? undefined : forbidden());
  };
