// A real browser uses the real app: the full path browser → React → Vite proxy → API → PostgreSQL.
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL ?? 'postgres://app@localhost:5432/travel_test', max: 2 });
const PASSWORD = 'test-only-password-123'; // pragma: allowlist secret  gitleaks:allow
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const uniqueEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;

async function register(page: Page, email = uniqueEmail()) {
  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'My trips' })).toBeVisible();
  return email;
}

async function createTrip(page: Page, from = 'DXB', to = 'LHR') {
  const form = page.getByRole('form', { name: 'New trip' });
  await form.getByLabel('From (IATA)').fill(from);
  await form.getByLabel('To (IATA)').fill(to);
  await form.getByLabel('Adults').fill('2');
  await form.getByRole('button', { name: 'Create trip' }).click();
}

test.afterAll(() => db.end());

test('full journey: register, create a trip, add passengers, log out', async ({ page }) => {
  await page.goto('/trips');
  await expect(page).toHaveURL(/\/login$/); // protected page → login
  const email = await register(page);
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText('No trips yet')).toBeVisible();

  await createTrip(page);
  await expect(page.getByRole('heading', { name: 'DXB → LHR' })).toBeVisible();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}$/);

  const add = page.getByRole('form', { name: 'Add passenger' });
  await add.getByLabel('Given name').fill('Aman');
  await add.getByLabel('Family name').fill('Khan');
  await add.getByLabel('Date of birth').fill('1995-04-10');
  await add.getByRole('button', { name: 'Add passenger' }).click();
  await expect(page.getByRole('cell', { name: 'Aman Khan' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Passengers (1 of 2)' })).toBeVisible();

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/trips');
  await expect(page).toHaveURL(/\/login$/); // cookie is dead on the server
});

test('shows field errors from the API next to the right input', async ({ page }) => {
  await register(page);
  await createTrip(page, 'DXB', 'DXB');
  await expect(page.getByText('Origin and destination must differ')).toBeVisible();
  await expect(page.getByLabel('To (IATA)')).toHaveAttribute('aria-invalid', 'true');
});

test('client-side check stops a short password before any request is sent', async ({ page }) => {
  let registerCalls = 0;
  page.on('request', (r) => r.url().includes('/api/auth/register') && registerCalls++);
  await page.goto('/register');
  await page.getByLabel('Email').fill(uniqueEmail());
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Use at least 10 characters')).toBeVisible();
  expect(registerCalls).toBe(0);
});

test('a script typed as a name is shown as text, never executed (XSS)', async ({ page }) => {
  let alerted = false;
  page.on('dialog', async (d) => {
    alerted = d.type() === 'alert';
    await d.dismiss();
  });
  await register(page);
  await createTrip(page);
  const add = page.getByRole('form', { name: 'Add passenger' });
  await add.getByLabel('Given name').fill('<img src=x onerror=alert(1)>');
  await add.getByLabel('Family name').fill('<script>alert(2)</script>');
  await add.getByLabel('Date of birth').fill('1990-01-01');
  await add.getByRole('button', { name: 'Add passenger' }).click();
  await expect(page.getByRole('cell', { name: '<img src=x onerror=alert(1)> <script>alert(2)</script>' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(alerted).toBe(false);
});

test("another user's trip link shows 'Trip not found'", async ({ page, browser }) => {
  await register(page);
  await createTrip(page);
  await expect(page.getByRole('heading', { name: 'DXB → LHR' })).toBeVisible();
  const url = page.url();

  const other = await browser.newContext(); // separate cookie jar = a different person
  const bob = await other.newPage();
  await register(bob);
  await bob.goto(url);
  await expect(bob.getByRole('heading', { name: 'Trip not found' })).toBeVisible();
  await other.close();
});

test('session ending mid-use sends the user to login with an explanation', async ({ page }) => {
  const email = await register(page);
  await db.query('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)', [email]);
  await createTrip(page); // the next API call gets 401
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Your session has ended. Please log in again.')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'My trips' })).toBeVisible(); // back where they were
});

test('API unreachable: clear message and a working retry', async ({ page }) => {
  await register(page);
  await page.route('**/api/trips', (route) => route.abort('connectionrefused')); // simulate the API being down
  await page.reload();
  await expect(page.getByText('Cannot reach the server. Check your connection and try again.')).toBeVisible();
  await page.unroute('**/api/trips'); // API is back
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('No trips yet')).toBeVisible();
});

test('slow API: a loading state instead of a blank screen', async ({ page }) => {
  await register(page);
  await page.route('**/api/trips', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.reload();
  await expect(page.getByText('Loading trips…')).toBeVisible();
  await expect(page.getByText('No trips yet')).toBeVisible({ timeout: 5000 });
});

test('server error shows the request ID the user can quote to support', async ({ page }) => {
  await register(page);
  await page.route('**/api/trips', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'DATABASE_UNAVAILABLE', message: 'The service is temporarily unavailable. Please try again shortly.', requestId: 'demo-req-12345' } }),
    }),
  );
  await page.reload();
  await expect(page.getByText('The service is temporarily unavailable. Please try again shortly.')).toBeVisible();
  await expect(page.getByText('Reference: demo-req-12345')).toBeVisible();
});
