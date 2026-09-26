// Reads configuration from environment variables once, at startup, and fails fast
// if anything is missing or malformed. Every other file imports `config` from here
// instead of touching process.env directly.
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'Must be a postgres:// connection URL' }),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // A bad config should stop the process immediately, with a readable reason,
  // rather than failing later in some unrelated request.
  console.error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

export const config = parsed.data;
