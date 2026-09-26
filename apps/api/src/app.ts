// Builds the Express app. Kept separate from server.ts (which listens on a port) so
// tests can send requests to the app in memory without opening a real port.
//
// Middleware runs top to bottom for every request. Order matters.
import express from 'express';
import { pinoHttp } from 'pino-http';
import { pool } from './db/pool.js';
import { logger } from './logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { tripsRouter } from './trips/trips.routes.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by'); // don't advertise the framework to attackers

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
  app.use(express.json({ limit: '100kb' })); // 3. parse JSON bodies, reject huge ones

  // 4. routes
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
  app.use('/trips', tripsRouter);

  // Deliberate failure route, used only to demonstrate how a bug is handled.
  if (process.env.NODE_ENV !== 'production') {
    app.get('/debug/boom', () => {
      throw new Error('Simulated bug: something we did not expect');
    });
  }

  // 5. nothing matched → 404; any error thrown above → errorHandler
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
