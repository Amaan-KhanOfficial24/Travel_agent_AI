// `npm run migrate`: apply pending migrations to the database in DATABASE_URL.
import { pool } from './pool.js';
import { migrate } from './migrate.js';

try {
  const applied = await migrate(pool);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
