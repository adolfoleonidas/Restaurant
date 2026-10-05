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

    // Admin management modules are reachable (Local holds sedes/zonas/mesas).
    await page.goto('/local');
    await expect(page.getByTestId('local-root')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('local-tab-mesas').click();
    await expect(page.getByTestId('mesa-config-nueva')).toBeVisible({ timeout: 15_000 });
    await page.goto('/configuracion');
    await expect(page.getByTestId('config-root')).toBeVisible({ timeout: 15_000 });

    // The system panel renders real backend data.
    await expect(page.getByTestId('system-info')).toBeVisible({ timeout: 15_000 });

    // Switching theme must really change the design tokens.
    const rootPrimary = () => page.evaluate(
      () => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
    );
    const frescoPrimary = await rootPrimary();
    await page.getByTestId('theme-calido').click();
    await expect.poll(rootPrimary, { timeout: 10_000 }).not.toBe(frescoPrimary);
    // Restore the default theme for the shared test database.
    await page.getByTestId('theme-fresco').click();
    await expect.poll(rootPrimary, { timeout: 10_000 }).toBe(frescoPrimary);

    // Branding controls render, and the public description round-trips to the menu.
    await expect(page.getByTestId('marca-save')).toBeVisible();
    await expect(page.getByTestId('marca-logo-input')).toBeAttached();
    await expect(page.getByTestId('marca-cover-input')).toBeAttached();

    const description = page.getByTestId('marca-description');
    const original = await description.inputValue();
    const probe = `Carta E2E ${Date.now()}`;
    const saveMarca = () => Promise.all([
      page.waitForResponse((r) => r.url().includes('/restaurants/current') && r.request().method() === 'PATCH'),
      page.getByTestId('marca-save').click(),
    ]);

    await description.fill(probe);
    await saveMarca();
    await page.goto('/');
    // The description shows both in the cover hero and the public footer.
    await expect(page.getByText(probe).first()).toBeVisible({ timeout: 15_000 });

    // Restore the original description for the shared test database.
    await page.goto('/configuracion');
    await page.getByTestId('marca-description').fill(original);
    await saveMarca();
  });
});
