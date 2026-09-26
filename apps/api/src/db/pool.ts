// The connection pool. Opening a Postgres connection costs a TCP + TLS handshake and
// authentication (tens of milliseconds), so we open a few once and lend them out:
// a request borrows a connection, runs its query, and gives it back.
import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../logger.js';

// Postgres `date` columns are plain calendar dates. By default the driver turns them
// into JavaScript Date objects at midnight *local time*, which can shift the day in
// other time zones. Keep them as 'YYYY-MM-DD' strings instead.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: config.DB_POOL_MAX, // at most this many connections open at once
  idleTimeoutMillis: 30_000, // close connections unused for 30 s
  connectionTimeoutMillis: 3_000, // fail fast if the DB is unreachable, instead of hanging
  statement_timeout: 5_000, // Postgres cancels any single query running longer than 5 s
});

// An idle connection can break (DB restarted, network blip). Without this listener
// that error would crash the whole process.
pool.on('error', (err) => logger.error({ err }, 'Idle database connection error'));

/** Run fn inside one transaction: all its queries succeed together or none do. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined); // connection may already be dead
    throw err;
  } finally {
    client.release(); // always return the connection to the pool
  }
}
