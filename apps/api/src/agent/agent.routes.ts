import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { agentService } from './agent.service.js';

const chatSchema = z.object({ conversationId: z.uuid().optional(), message: z.string().trim().min(1).max(2000) });

// Each message can cost several model calls; keep a user within the free tier.
const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: config.NODE_ENV === 'test' ? 1000 : 10,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ''),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, 'TOO_MANY_REQUESTS', 'Too many messages. Please wait a minute.')),
});

export const agentRouter = Router();
agentRouter.use(requireAuth);

agentRouter.post('/chat', chatLimiter, validate(chatSchema), async (req, res) => {
  res.json({ data: await agentService.chat(req.user!, res.locals.body) });
});

agentRouter.get('/conversations/:id', validate(z.object({ id: z.uuid() }), 'params'), async (req, res) => {
  res.json({ data: await agentService.history(req.user!, res.locals.params.id) });
});
