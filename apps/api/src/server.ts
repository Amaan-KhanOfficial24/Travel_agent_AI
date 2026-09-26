// Entry point: bring the database schema up to date, start listening, and shut down
// cleanly when the platform stops us.
import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { logger } from './logger.js';

// Apply pending migrations before accepting traffic, so code never runs against an
// older schema. (Larger systems run migrations as a separate deploy step instead.)
try {
  const applied = await migrate(pool);
  logger.info({ applied }, applied.length ? 'Migrations applied' : 'Database schema up to date');
} catch (err) {
  logger.fatal({ err }, 'Could not migrate database; refusing to start');
  process.exit(1);
}

const server = createApp().listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'API listening');
});

// Hosting platforms send SIGTERM before stopping a container. Finish in-flight
// requests, close database connections, then exit.
function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref(); // hard stop if something hangs
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// A crash we did not catch: log it and exit so the platform restarts us cleanly.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  process.exit(1);
});
