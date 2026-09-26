// Entry point: start listening, and shut down cleanly when the platform stops us.
import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';

const server = createApp().listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'API listening');
});

// Hosting platforms send SIGTERM before stopping a container. Finish in-flight
// requests, then exit, instead of cutting users off mid-request.
function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref(); // hard stop if something hangs
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// A crash we did not catch: log it and exit so the platform restarts us cleanly.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  process.exit(1);
});
