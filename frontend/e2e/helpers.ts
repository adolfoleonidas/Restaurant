import { Page, expect } from '@playwright/test';

/**
 * Shared helpers for the MVP flow journeys (E4 desktop / E5 mobile).
 * The branch-bound test users are provisioned by `e2e/fixtures/seed-roles.js`
 * (role + `branch_id=Sucursal MVP`) so that branch isolation is exercised,
 * not bypassed.
 */
export const TEST_USERS = {
  mozo: { email: 'mozo.test@example.com', password: 'test1234' },
  cocina: { email: 'cocinero.test@example.com', password: 'test1234' },
  cajero: { email: 'cajero.test@example.com', password: 'test1234' },
};

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByTestId('login-email-input').fill(email);
  await page.getByTestId('login-password-input').fill(password);
  await page.getByTestId('login-submit-button').click();
  await expect(page.getByTestId('logout-button')).toBeVisible({ timeout: 15_000 });
}

export async function logout(page: Page) {
  await page.getByTestId('logout-button').click();
  await expect(page.getByTestId('login-email-input')).toBeVisible({ timeout: 15_000 });
}

/** Save a step screenshot under e2e/artifacts (ignored in git). */
export async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e/artifacts/${name}.png` });
}
