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
  // Comma-separated list of browser origins allowed to call the API with cookies,
  // e.g. "http://localhost:5173,https://my-app.vercel.app". Nothing else is allowed.
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(24 * 7),
  // Stage 10: frontend and API on different sites need SameSite=None (with Secure).
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  // How many reverse proxies sit in front of the API (Render: 1). Only then is the
  // X-Forwarded-For header trustworthy. With 0, the client IP comes from the TCP
  // connection and a faked X-Forwarded-For header is ignored.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
  // Login/register attempts allowed per IP per 15 minutes (raised only for automated tests).
  AUTH_RATE_LIMIT: z.coerce.number().int().min(1).max(10_000).default(10),

  // Duffel flight API. Test tokens start with duffel_test_ and can never issue real tickets.
  DUFFEL_ACCESS_TOKEN: z.string().trim().default(''),
  DUFFEL_BASE_URL: z.url().default('https://api.duffel.com'),
  DUFFEL_SUPPLIER_TIMEOUT_MS: z.coerce.number().int().min(2_000).max(60_000).default(20_000),
  // Safety switch: a live token books and pays for REAL tickets. Refused unless true.
  ALLOW_LIVE_BOOKINGS: z.stringbool().default(false),

  // Google Gemini for the AI assistant (free tier: Flash / Flash-Lite models).
  GEMINI_API_KEY: z.string().trim().default(''),
  GEMINI_MODEL: z.string().trim().default('gemini-flash-latest'),
  GEMINI_BASE_URL: z.url().default('https://generativelanguage.googleapis.com'),

  // Fare-change recovery guard rails.
  BOOKING_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  BOOKING_MAX_INCREASE_PCT: z.coerce.number().min(0).max(200).default(25),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // A bad config should stop the process immediately, with a readable reason,
  // rather than failing later in some unrelated request.
  console.error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

// In GitHub Codespaces the frontend is opened on https://<codespace>-5173.<domain>.
// Codespaces tells us both parts in environment variables, so allow that one origin
// automatically instead of asking the user to type it.
const { CODESPACE_NAME, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN } = process.env;
if (CODESPACE_NAME && GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
  parsed.data.CORS_ORIGINS.push(`https://${CODESPACE_NAME}-5173.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`);
}

if (parsed.data.DUFFEL_ACCESS_TOKEN.startsWith('duffel_live_') && !parsed.data.ALLOW_LIVE_BOOKINGS) {
  console.error('DUFFEL_ACCESS_TOKEN is a LIVE token (real tickets, real money). Use a duffel_test_ token, or set ALLOW_LIVE_BOOKINGS=true deliberately.');
  process.exit(1);
}

export const config = parsed.data;
