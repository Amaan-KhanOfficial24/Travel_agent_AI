// `npm run check`: verifies everything the app needs, and calls the REAL Duffel and Gemini
// APIs once each with your keys, so a wrong key shows up here and not in the middle of a booking.
// Keys are never printed.
import pg from 'pg';

const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { console.log(`  ❌ ${m}`); process.exitCode = 1; };
const warn = (m) => console.log(`  ⚠️  ${m}`);

console.log('\nTravel Agent setup check\n');

// 1. Database
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) bad('DATABASE_URL is not set');
else {
  const pool = new pg.Pool({ connectionString: dbUrl, connectionTimeoutMillis: 3000 });
  try {
    await pool.query('SELECT 1');
    ok('Database reachable');
  } catch (e) {
    bad(`Database not reachable (${e.code ?? e.message}). Start it with: docker compose up -d db`);
  } finally {
    await pool.end();
  }
}

// 2. Duffel
const duffel = process.env.DUFFEL_ACCESS_TOKEN ?? '';
if (!duffel) bad('DUFFEL_ACCESS_TOKEN is not set (see SETUP.md step 1)');
else if (duffel.startsWith('duffel_live_')) bad('DUFFEL_ACCESS_TOKEN is a LIVE token. Use a test token (duffel_test_...)');
else {
  if (!duffel.startsWith('duffel_test_')) warn('DUFFEL_ACCESS_TOKEN does not start with duffel_test_; is it a test token?');
  try {
    const r = await fetch('https://api.duffel.com/air/airlines?limit=1', {
      headers: { Authorization: `Bearer ${duffel}`, 'Duffel-Version': 'v2', Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (r.ok) ok('Duffel accepted the token (test mode)');
    else bad(`Duffel rejected the token (HTTP ${r.status}). Create a new test token in the Duffel dashboard.`);
  } catch (e) {
    bad(`Cannot reach api.duffel.com (${e.message})`);
  }
}

// 3. Gemini
const gemini = process.env.GEMINI_API_KEY ?? '';
const model = process.env.GEMINI_MODEL ?? 'gemini-flash-latest';
if (!gemini) warn('GEMINI_API_KEY is not set: everything works except the AI assistant (see SETUP.md step 2)');
else {
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': gemini },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ready' }] }] }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await r.json().catch(() => ({}));
    if (r.ok) ok(`Gemini answered using model ${model}`);
    else if (r.status === 404) bad(`Gemini model "${model}" not found. Set GEMINI_MODEL to a model listed in AI Studio (e.g. a current Flash model).`);
    else if (r.status === 429) warn('Gemini key works but the free quota is used up for now; try again later');
    else bad(`Gemini rejected the request (HTTP ${r.status}: ${body?.error?.message ?? 'unknown error'})`);
  } catch (e) {
    bad(`Cannot reach Gemini (${e.message})`);
  }
}

console.log(process.exitCode ? '\nFix the ❌ items above, then run npm run check again.\n' : '\nAll good. Start the app with: npm run dev\n');
