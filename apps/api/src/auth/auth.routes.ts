import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { loginSchema, registerSchema } from './auth.schema.js';
import { authService } from './auth.service.js';
import { clearSessionCookie, setSessionCookie } from './sessions.js';

// Brute-force protection: at most 10 login/register attempts per IP per 15 minutes.
// (In memory, per API instance. Production keeps the counters in Redis so all
// instances share them.)
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.NODE_ENV === 'test' ? 1000 : config.AUTH_RATE_LIMIT,
  standardHeaders: 'draft-8', // tells the client its remaining budget in RateLimit headers
  legacyHeaders: false,
  handler: (_req, _res, next) =>
    next(new AppError(429, 'TOO_MANY_REQUESTS', 'Too many attempts. Please wait 15 minutes and try again.')),
});

export const authRouter = Router();

authRouter.post('/register', authLimiter, validate(registerSchema), async (req, res) => {
  const { email, password } = res.locals.body;
  const { user, session } = await authService.register(email, password, req.get('user-agent'));
  setSessionCookie(res, session.token, session.expiresAt);
  res.status(201).json({ data: user });
});

authRouter.post('/login', authLimiter, validate(loginSchema), async (req, res) => {
  const { email, password } = res.locals.body;
  const { user, session } = await authService.login(email, password, req.get('user-agent'));
  setSessionCookie(res, session.token, session.expiresAt);
  res.json({ data: user });
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  await authService.logout(req.user!.sessionId);
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json({ data: await authService.me(req.user!.id) });
});
