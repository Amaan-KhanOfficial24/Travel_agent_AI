// Builds the Express app. Kept separate from server.ts (which listens on a port) so
// tests can send requests to the app in memory without opening a real port.
//
// Middleware runs top to bottom for every request. Order matters.
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { adminRouter } from './admin/admin.routes.js';
import { authRouter } from './auth/auth.routes.js';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { logger } from './logger.js';
import { authenticate } from './middleware/auth.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { tripsRouter } from './trips/trips.routes.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by'); // don't advertise the framework to attackers
  // Behind a proxy (Render, Stage 10) the real client IP arrives in X-Forwarded-For,
  // appended by the proxy. Trust exactly that many hops and no more: trusting it with
  // no proxy in front would let any client fake its IP and dodge the rate limiter.
  app.set('trust proxy', config.TRUST_PROXY_HOPS);

  app.use(requestId); // 1. give the request an ID first, so every later log has it
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id, // 2. log start/finish with that ID
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  // 3. security headers: no MIME sniffing, no framing (clickjacking), HSTS, strict CSP.
  //    The API only ever returns JSON, so the strictest content policy costs nothing.
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
  // 4. CORS: which OTHER websites' JavaScript may call this API with the user's cookies.
  //    Only our own frontend origins; every other site gets no CORS headers, so the
  //    browser blocks its script from reading our responses.
  app.use(cors({ origin: config.CORS_ORIGINS, credentials: true }));
  app.use(express.json({ limit: '100kb' })); // 5. parse JSON bodies, reject huge ones
  app.use(cookieParser()); // 6. read cookies into req.cookies
  app.use(csrfProtection); // 7. block state-changing requests from foreign origins
  app.use(authenticate); // 8. session cookie → req.user (or undefined)

  // 9. routes
  // Liveness + readiness: the process is up AND it can reach the database.
  // Hosting platforms call this to decide whether to send traffic to this instance.
  app.get('/health', async (_req, res) => {
    const started = Date.now();
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', database: 'up', dbLatencyMs: Date.now() - started, uptimeSeconds: Math.round(process.uptime()) });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'down', uptimeSeconds: Math.round(process.uptime()) });
    }
  });
  app.use('/auth', authRouter);
  app.use('/trips', tripsRouter);
  app.use('/admin', adminRouter);

  // Deliberate failure route, used only to demonstrate how a bug is handled.
  if (process.env.NODE_ENV !== 'production') {
    app.get('/debug/boom', () => {
      throw new Error('Simulated bug: something we did not expect');
    });
  }

  // 10. nothing matched → 404; any error thrown above → errorHandler
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
