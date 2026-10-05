import { test, expect } from '@playwright/test';

test.describe('smoke', () => {
  test('login screen renders and admin login lands on the authed app', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('login-email-input')).toBeVisible();
    await expect(page.getByTestId('login-submit-button')).toBeVisible();
    await page.screenshot({ path: 'e2e/artifacts/smoke-01-login.png' });

    await page.getByTestId('login-email-input').fill('admin@resto.com');
    await page.getByTestId('login-password-input').fill('admin123');
    await page.getByTestId('login-submit-button').click();

    await expect(page.getByTestId('logout-button')).toBeVisible({ timeout: 15_000 });
    await expect(page).not.toHaveURL(/login/);
    await page.screenshot({ path: 'e2e/artifacts/smoke-02-authed.png' });

    const token = await page.evaluate(() => window.localStorage.getItem('token'));
    expect(token).toBeTruthy();
    await page.screenshot({ path: 'e2e/artifacts/smoke-03-after-login.png' });
  });
});
