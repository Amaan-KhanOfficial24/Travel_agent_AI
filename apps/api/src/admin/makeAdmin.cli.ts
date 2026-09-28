// `npm run make-admin -- someone@example.com`: promote an existing account to admin.
// Admin rights are granted from the server's command line on purpose: there is no API
// endpoint that can make someone an admin, so no web request can escalate privileges.
import { pool } from '../db/pool.js';

const email = process.argv[2]?.trim().toLowerCase();
try {
  if (!email) throw new Error('Usage: npm run make-admin -- <email>');
  const { rowCount } = await pool.query("UPDATE users SET role = 'admin' WHERE email = $1", [email]);
  if (rowCount !== 1) throw new Error(`No account with email ${email}`);
  console.log(`${email} is now an admin`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
