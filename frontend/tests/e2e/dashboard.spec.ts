import { expect, test, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import fs from 'fs';

/**
 * What your father does on the dashboard, clicked through in a real browser.
 * Seed data (backend/scripts/e2e-server.ts):
 *   Siddhi Stone ₹31,500 billed, ₹10,000 paid → ₹21,500 due
 *   Mohan ₹800 advance
 *   Ramesh Traders ₹5,000 payment WAITING for confirmation
 */
const PASSWORD = 'test-password-123';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('Enter Dashboard Password').fill(PASSWORD);
  await page.getByRole('button', { name: /secure login/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** Click a sidebar link; on phones the sidebar is behind the ☰ menu button first. */
async function goTo(page: Page, name: RegExp) {
  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name }).first().click();
}

test.describe.configure({ mode: 'serial' });

// Each browser project (desktop, mobile) starts from the same seeded ledger
test.beforeAll(() => {
  execSync('npm --prefix ../backend run --silent e2e:server -- --seed-only', {
    env: { ...process.env, E2E_DATABASE_URL: process.env.E2E_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/voicekhata_e2e_test' },
    stdio: 'pipe',
  });
});

test('the dashboard is locked without logging in', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
});

test('wrong password shows an error and stays on the login page', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('Enter Dashboard Password').fill('not-the-password');
  await page.getByRole('button', { name: /secure login/i }).click();
  await expect(page.getByText('Invalid password')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('overview shows the real numbers and the pending entry', async ({ page }) => {
  await login(page);
  await expect(page.getByText('₹21,500').first()).toBeVisible(); // market outstanding
  await expect(page.getByText('₹31,500').first()).toBeVisible(); // sales this month
  const pending = page.getByRole('region', { name: /waiting for confirmation/i });
  await expect(pending).toContainText('Ramesh Traders');
  await expect(pending).toContainText('₹5,000.00');
});

test('confirming from the dashboard updates the khata', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /confirm entry/i }).click();
  await expect(page.getByRole('region', { name: /waiting for confirmation/i })).toHaveCount(0);

  await goTo(page, /parties & ledgers/i);
  await page.getByRole('link', { name: /ramesh traders/i }).click();
  await expect(page.getByRole('heading', { name: 'Ramesh Traders' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Payment received' })).toContainText('Confirmed');
});

test('khata page downloads a real PDF', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard/parties');
  await page.getByRole('link', { name: /siddhi stone/i }).click();
  await expect(page.getByText('Outstanding (to collect)').locator('..')).toContainText('₹21,500.00');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /download khata pdf/i }).click()]);
  expect(download.suggestedFilename()).toBe('Khata_Siddhi_Stone.pdf');
  const bytes = fs.readFileSync((await download.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
});

test('this month\'s CSV export downloads', async ({ page }) => {
  await login(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /export this month/i }).click()]);
  const csv = fs.readFileSync((await download.path())!, 'utf8');
  expect(csv).toContain('date_ist,ref,status,type,party_or_worker');
  expect(csv).toContain('Siddhi Stone');
});

test('worker page shows the advance', async ({ page }) => {
  await login(page);
  await goTo(page, /workers & advances/i);
  await page.getByRole('link', { name: /mohan/i }).click();
  await expect(page.getByText('Advance outstanding').locator('..')).toContainText('₹800.00');
  await expect(page.getByRole('row').filter({ hasText: 'Advance given' })).toContainText('₹800.00');
});

test('the API refuses requests without a token', async ({ request }) => {
  const res = await request.get('http://localhost:3100/api/parties');
  expect(res.status()).toBe(401);
});
