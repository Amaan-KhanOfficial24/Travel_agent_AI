// A minimal migration runner, written by hand so nothing is hidden.
// Migrations are numbered SQL files applied in order, each exactly once. A table,
// schema_migrations, records which ones have run. Tools like node-pg-migrate,
// Flyway or Prisma Migrate do the same thing with more features.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { logger } from '../logger.js';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations');

export async function migrate(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect();
  try {
    // An advisory lock: if two API instances start at once, only one runs migrations.
    await client.query('SELECT pg_advisory_lock(7291)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);

    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const applied: string[] = [];

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      // Each migration runs in its own transaction: a failing migration leaves
      // no half-created tables behind.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
        logger.info({ migration: file }, 'Migration applied');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock(7291)').catch(() => undefined);
    client.release();
  }
}
