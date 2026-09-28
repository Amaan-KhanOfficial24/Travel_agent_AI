// Search → check price → book, fare-change approval, and booking through the assistant,
// in a real browser against the real API and the stand-in Duffel/Gemini servers.
import { expect, test, type Page } from '@playwright/test';

// On failure, report what the browser was showing and any page errors (visible in CI annotations).
const pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()));
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 600);
    throw new Error(`DIAGNOSTICS url=${page.url()}\nerrors=${JSON.stringify(pageErrors)}\nbody=${body}`);
  }
});

const PASSWORD = 'test-only-password-123'; // pragma: allowlist secret  gitleaks:allow
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

async function register(page: Page) {
  await page.goto('/register');
  await page.getByLabel('Email').fill(`e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'My trips' })).toBeVisible();
}

async function tripWithOneAdult(page: Page, from: string, to: string) {
  const f = page.getByRole('form', { name: 'New trip' });
  await f.getByLabel('From (IATA)').fill(from);
  await f.getByLabel('To (IATA)').fill(to);
  await f.getByLabel('Departure').fill(future(40));
  await f.getByRole('button', { name: 'Create trip' }).click();
  const add = page.getByRole('form', { name: 'Add passenger' });
  await add.getByLabel('Given name').fill('Aman');
  await add.getByLabel('Family name').fill('Khan');
  await add.getByLabel('Date of birth').fill('1995-04-10');
  await add.getByRole('button', { name: 'Add passenger' }).click();
  await page.getByRole('link', { name: 'Search flights for this trip' }).click();
  await expect(page.getByTestId('offer').first()).toBeVisible();
}

async function fillContactAndBook(page: Page) {
  await page.getByLabel('Phone (international, e.g. +971501234567)').fill('+971501234567');
  await page.getByRole('button', { name: /^Confirm and book for/ }).click();
}

test('trip → search → price changed → book → confirmed with PNR', async ({ page }) => {
  await register(page);
  await tripWithOneAdult(page, 'LHR', 'STN');
  await page.getByRole('button', { name: 'Check price' }).first().click();
  await expect(page.getByText('The price has changed.')).toBeVisible();
  await page.getByRole('button', { name: /^Book for/ }).click();
  await expect(page.getByRole('heading', { name: 'Review and book' })).toBeVisible();
  await fillContactAndBook(page);
  await expect(page.getByTestId('booking-state')).toHaveText('Confirmed');
  await expect(page.getByTestId('pnr')).toHaveText(/^[A-Z0-9]{6}$/);
  await page.getByRole('link', { name: 'Bookings', exact: true }).click();
  await expect(page.getByText('LHR → STN')).toBeVisible();
});

test('fare rises during booking → approval card → approve → confirmed', async ({ page }) => {
  await register(page);
  await tripWithOneAdult(page, 'LHR', 'GLA');
  await page.getByRole('button', { name: 'Check price' }).first().click();
  await expect(page.getByText('Price confirmed:')).toBeVisible();
  await page.getByRole('button', { name: /^Book for/ }).click();
  await fillContactAndBook(page);
  await expect(page.getByTestId('booking-state')).toHaveText('Needs your approval');
  await expect(page.getByTestId('approval')).toContainText('The fare changed while booking');
  await page.getByRole('button', { name: /^Approve .* and book$/ }).click();
  await expect(page.getByTestId('booking-state')).toHaveText('Confirmed');
  await expect(page.getByText(/New fare USD/)).toBeVisible(); // in the history
});

test('bad phone number is shown on the field and nothing is booked', async ({ page }) => {
  await register(page);
  await tripWithOneAdult(page, 'DXB', 'LHR');
  await page.getByRole('button', { name: 'Check price' }).first().click();
  await page.getByRole('button', { name: /^Book for/ }).click();
  await page.getByLabel('Phone (international, e.g. +971501234567)').fill('0501234567');
  await page.getByRole('button', { name: /^Confirm and book for/ }).click();
  await expect(page.getByText('Use international format, e.g. +971501234567')).toBeVisible();
});

test('assistant: ask in plain language → options → check price → book → confirmed', async ({ page }) => {
  await register(page);
  await page.getByRole('link', { name: 'Assistant' }).click();
  await page.getByLabel('Message').fill(`Find flights from DXB to LHR on ${future(35)} for 1 adult`);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('msg-assistant').last()).toContainText('The cheapest is Duffel Airways at');
  await page.getByRole('button', { name: 'Check price' }).first().click();
  await page.getByRole('button', { name: /^Book for/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Review and book' })).toBeVisible();
  await page.getByLabel(/Given name/).fill('Aman');
  await page.getByLabel('Family name').fill('Khan');
  await page.getByLabel('Date of birth').fill('1995-04-10');
  await fillContactAndBook(page);
  await expect(page.getByTestId('booking-state')).toHaveText('Confirmed');
});
