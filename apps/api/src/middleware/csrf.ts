// CSRF (cross-site request forgery): a malicious site makes the victim's browser send a
// request to our API; the browser attaches our session cookie automatically. Defences:
//   1. SameSite cookies (sessions.ts): browsers don't send them on cross-site POSTs.
//   2. This check: a state-changing request must come from one of our own origins.
//   3. JSON only: an HTML form cannot send Content-Type: application/json cross-site
//      without a CORS preflight, which our CORS policy refuses for unknown origins.
import type { RequestHandler } from 'express';
import { config } from '../config.js';
import { AppError, forbidden } from '../errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next(); // reads must never change state

  // Browsers always send Origin on cross-origin POST/PUT/PATCH/DELETE. A missing Origin
  // means a non-browser client (curl, a server, a test), which cannot carry a victim's
  // cookies, so it is not a CSRF risk.
  const origin = req.get('origin');
  if (origin && !config.CORS_ORIGINS.includes(origin)) {
    return next(forbidden('Cross-site request blocked'));
  }

  // Requests with a body must be JSON.
  if (req.headers['content-length'] !== '0' && req.headers['content-length'] && !req.is('application/json')) {
    return next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the request body as application/json'));
  }
  next();
};
