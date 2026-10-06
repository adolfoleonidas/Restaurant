import { test, expect, Page } from '@playwright/test';
import { TEST_USERS, login, logout, shot } from './helpers';
import { getTableNumbers } from './runtime';

/**
 * E5 — Mobile MVP journey (iPhone 12 viewport, coarse pointer).
 *
 * Exercises the same core flow and asserts the touch-first CobrarDialog:
 * full-bleed layout, collapsed "Ver N items" toggle, method grid, and the
 * on-screen numeric keypad.
 */
const TABLE = getTableNumbers().mobileTable;

async function takeTableAndOrder(page: Page, tableNumber: number) {
  await expect(page.getByTestId('salon-root')).toBeVisible({ timeout: 15_000 });
  const card = page.getByTestId(`mesa-card-${tableNumber}`);
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByTestId('mesa-sheet')).toBeVisible();
  // The table sheet carries the composer (unified composer): the first product
  // creates the account and the backend sends it to the kitchen on that same
  // call, so the item row is the confirmation to assert.
  await page.locator('[data-testid^="mesa-sheet-producto-"]:not([disabled])').first().click();
  await expect(page.getByTestId('mesa-sheet-items')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('mesa-sheet')).toBeHidden();
  await expect(page.getByTestId('salon-root')).toBeVisible({ timeout: 15_000 });
  await expect(card).toHaveAttribute('data-floor-state', 'preparando');
}

test('mobile: mozo → cocina → caja con CobrarDialog táctil', async ({ page }) => {
  // ── Mozo: order ─────────────────────────────────────────────────────────
  await login(page, TEST_USERS.mozo.email, TEST_USERS.mozo.password);
  await shot(page, `e5-${TABLE}-01-mozo-login`);
  await takeTableAndOrder(page, TABLE);

  // ── Cocina: llegan → fuego → listo ──────────────────────────────────────
  await logout(page);
  await login(page, TEST_USERS.cocina.email, TEST_USERS.cocina.password);
  await expect(page.getByTestId('cocina-kanban')).toBeVisible({ timeout: 15_000 });
  // Scope to this run's table: stale tickets from other runs share the column.
  // Tables are seeded as "Mesa E2E <number>", so match the number only.
  const lleganTicket = page
    .locator('[data-testid^="cocina-ticket-"][data-testid$="-llegan"]')
    .filter({ hasText: String(TABLE) })
    .first();
  await expect(lleganTicket).toBeVisible({ timeout: 15_000 });
  const orderNumber = ((await lleganTicket.getAttribute('data-testid')) || '').match(
    /cocina-ticket-(\d+)-llegan/,
  )?.[1];
  expect(orderNumber).toBeTruthy();
  await lleganTicket.getByRole('button', { name: 'Pasar a fuego' }).click();
  const fuegoTicket = page.getByTestId(`cocina-ticket-${orderNumber}-fuego`);
  await expect(fuegoTicket).toBeVisible({ timeout: 15_000 });
  await fuegoTicket.getByRole('button', { name: 'Avanzar pedido' }).click();
  await expect(page.getByTestId(`cocina-ticket-${orderNumber}-listo`)).toBeVisible({ timeout: 15_000 });

  // ── Mozo: solicitar cuenta ──────────────────────────────────────────────
  await logout(page);
  await login(page, TEST_USERS.mozo.email, TEST_USERS.mozo.password);
  const tableCard = page.getByTestId(`mesa-card-${TABLE}`);
  await expect(tableCard).toHaveAttribute('data-floor-state', 'listo');
  await tableCard.click();
  await expect(page.getByTestId('mesa-sheet')).toBeVisible();
  // Ver el pedido es una acción ocasional: vive en ⋯ Más.
  await page.getByTestId('mesa-sheet-mas').click();
  await page.getByTestId('mesa-sheet-ver-pedido').click();
  await expect(page.getByTestId('pedido-detalle-root')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('pedido-solicitar-cuenta-button').click();
  await expect(page.getByTestId('salon-root')).toBeVisible({ timeout: 15_000 });
  await expect(tableCard).toHaveAttribute('data-floor-state', 'cuenta');

  // ── Cajero: abrir caja + cobrar (táctil) ────────────────────────────────
  await logout(page);
  await login(page, TEST_USERS.cajero.email, TEST_USERS.cajero.password);
  await expect(page.getByTestId('caja-root')).toBeVisible({ timeout: 15_000 });
  const apertura = page.getByTestId('caja-apertura-submit');
  if (await apertura.isVisible().catch(() => false)) {
    await page.getByTestId('caja-apertura-monto').fill('100');
    await apertura.click();
  }

  // Scoped to "Cuentas solicitadas" and to this run's table: order numbers
  // restart, so two accounts can carry the same number (and the same testid).
  await page
    .getByTestId('caja-solicitadas')
    .locator(`[data-testid="caja-pedido-${orderNumber}"]`)
    .filter({ hasText: `Mesa ${TABLE}` })
    .getByTestId(`caja-cobrar-${orderNumber}`)
    .click();
  await expect(page.getByTestId('caja-cobrar-dialog')).toBeVisible({ timeout: 15_000 });

  // Touch-first CobrarDialog assertions.
  await expect(page.getByRole('button', { name: /Ver \d+ items/ })).toBeVisible();
  // Method grid (all six payment methods).
  for (const m of ['efectivo', 'yape', 'plin', 'tarjeta', 'transferencia', 'mixto']) {
    await expect(page.getByTestId(`caja-metodo-${m}`)).toBeVisible();
  }
  // Coarse pointer shows the on-screen numeric keypad for cash.
  await expect(page.getByRole('group', { name: 'Teclado numérico de efectivo' })).toBeVisible();
  await shot(page, `e5-${TABLE}-08-cobrar-dialog-mobile`);

  await page.getByRole('button', { name: 'Exacto' }).click();
  const registrar = page.getByTestId('caja-cobrar-submit-button');
  await expect(registrar).toBeEnabled();
  await registrar.click();
  await page.getByTestId('caja-verificar-check').check();
  await page.getByTestId('caja-verificar-registrar').click();
  await expect(page.getByTestId('caja-pago-ok')).toBeVisible({ timeout: 15_000 });
  await shot(page, `e5-${TABLE}-09-pago-ok`);
});
