import { test, expect, Page } from '@playwright/test';
import { TEST_USERS, login, logout, shot } from './helpers';
import { getTableNumbers } from './runtime';

/**
 * E4 — Desktop MVP journey (mozo → cocina → cuenta → caja → cobro).
 *
 * Uses the branch-bound test users from seed-roles.js so branch isolation is
 * exercised end-to-end (mozo/cocina/cajero all share `Sucursal MVP`).
 */
const TABLE = getTableNumbers().desktopTable;

async function takeTableAndOrder(page: Page, tableNumber: number) {
  // Mozo home is /mesas.
  await expect(page.getByTestId('salon-root')).toBeVisible({ timeout: 15_000 });

  // The table sheet carries the composer: since the unified composer landed,
  // taking an order never leaves the floor (no areas dialog, no /pedidos/nuevo).
  const card = page.getByTestId(`mesa-card-${tableNumber}`);
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByTestId('mesa-sheet')).toBeVisible();

  // The first product creates the account, and the backend sends it to the
  // kitchen on that same call (`_derive_kitchen_status`), so the sheet has no
  // "Enviar a cocina" step: the item row is the confirmation to assert.
  await page.locator('[data-testid^="mesa-sheet-producto-"]:not([disabled])').first().click();
  await expect(page.getByTestId('mesa-sheet-items')).toBeVisible({ timeout: 10_000 });
  await shot(page, `e4-${tableNumber}-03-pedido-producto`);

  // Back on the floor; the table is now "preparando".
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('mesa-sheet')).toBeHidden();
  await expect(page.getByTestId('salon-root')).toBeVisible({ timeout: 15_000 });
  await expect(card).toHaveAttribute('data-floor-state', 'preparando');
}

test('mozo → cocina → cuenta → caja: efectivo exacto hasta pagado', async ({ page }) => {
  // ── 1. Mozo: take table and send an order to the kitchen ───────────────
  await login(page, TEST_USERS.mozo.email, TEST_USERS.mozo.password);
  await shot(page, `e4-${TABLE}-01-mozo-login`);
  await takeTableAndOrder(page, TABLE);

  // ── 2. Cocina: advance llegan → fuego → listo ───────────────────────────
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
  await shot(page, `e4-${TABLE}-04-cocina-llegan`);

  const orderNumber = ((await lleganTicket.getAttribute('data-testid')) || '').match(
    /cocina-ticket-(\d+)-llegan/,
  )?.[1];
  expect(orderNumber).toBeTruthy();

  // Pasar a fuego
  await lleganTicket.getByRole('button', { name: 'Pasar a fuego' }).click();
  const fuegoTicket = page.getByTestId(`cocina-ticket-${orderNumber}-fuego`);
  await expect(fuegoTicket).toBeVisible({ timeout: 15_000 });

  // Avanzar pedido → listo
  await fuegoTicket.getByRole('button', { name: 'Avanzar pedido' }).click();
  const listoTicket = page.getByTestId(`cocina-ticket-${orderNumber}-listo`);
  await expect(listoTicket).toBeVisible({ timeout: 15_000 });
  await shot(page, `e4-${TABLE}-05-cocina-listo`);

  // ── 3. Mozo: solicit the bill (→ pendiente_pago) ────────────────────────
  await logout(page);
  await login(page, TEST_USERS.mozo.email, TEST_USERS.mozo.password);
  const tableCard = page.getByTestId(`mesa-card-${TABLE}`);
  await expect(tableCard).toHaveAttribute('data-floor-state', 'listo');
  await tableCard.click();
  await expect(page.getByTestId('mesa-sheet')).toBeVisible();
  await page.getByTestId('mesa-sheet-ver-pedido').click();

  await expect(page.getByTestId('pedido-detalle-root')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('pedido-solicitar-cuenta-button').click();
  await expect(page.getByTestId('salon-root')).toBeVisible({ timeout: 15_000 });
  await expect(tableCard).toHaveAttribute('data-floor-state', 'cuenta');
  await shot(page, `e4-${TABLE}-06-cuenta-solicitada`);

  // Reopening the table must show the requested state, never offer the request again.
  await tableCard.click();
  await expect(page.getByTestId('mesa-sheet')).toBeVisible();
  await expect(page.getByTestId('mesa-sheet-cuenta-solicitada')).toBeVisible();
  await expect(page.getByTestId('mesa-sheet-cuenta-solicitada')).toBeDisabled();
  await expect(page.getByTestId('mesa-sheet-solicitar-cuenta')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('mesa-sheet')).toBeHidden();

  // ── 4. Cajero: open the register and collect efectivo ───────────────────
  await logout(page);
  await login(page, TEST_USERS.cajero.email, TEST_USERS.cajero.password);
  await expect(page.getByTestId('caja-root')).toBeVisible({ timeout: 15_000 });

  // Open the register if it is not open yet.
  const apertura = page.getByTestId('caja-apertura-submit');
  if (await apertura.isVisible().catch(() => false)) {
    await page.getByTestId('caja-apertura-monto').fill('100');
    await apertura.click();
    await shot(page, `e4-${TABLE}-07-caja-apertura`);
  }

  // The requested bill must show as "Cuentas solicitadas" and be collectable.
  // Scoped to that section AND to this run's table: order numbers restart, so
  // two accounts can carry the same number (and therefore the same testid).
  const cobrar = page
    .getByTestId('caja-solicitadas')
    .locator(`[data-testid="caja-pedido-${orderNumber}"]`)
    .filter({ hasText: `Mesa ${TABLE}` })
    .getByTestId(`caja-cobrar-${orderNumber}`);
  await expect(cobrar).toBeVisible({ timeout: 15_000 });
  await cobrar.click();

  // CobrarDialog: efectivo exacto → verify → registrar.
  await expect(page.getByTestId('caja-cobrar-dialog')).toBeVisible({ timeout: 15_000 });
  await shot(page, `e4-${TABLE}-08-cobrar-dialog`);
  // An empty cash field means "exact": the primary action must work without typing.
  await expect(page.getByTestId('caja-cobrar-submit-button')).toBeEnabled();
  await page.getByRole('button', { name: 'Exacto' }).click();
  const registrar = page.getByTestId('caja-cobrar-submit-button');
  await expect(registrar).toBeEnabled();
  await registrar.click();
  await page.getByTestId('caja-verificar-check').check();
  await page.getByTestId('caja-verificar-registrar').click();

  await expect(page.getByTestId('caja-pago-ok')).toBeVisible({ timeout: 15_000 });
  await shot(page, `e4-${TABLE}-09-pago-ok`);

  // ── 5. Historial shows the registered payment ───────────────────────────
  await page.getByTestId('caja-siguiente').click();
  await page.getByRole('button', { name: 'Historial' }).click();
  const historial = page.getByTestId('caja-historial-pagos');
  await expect(historial).toBeVisible();
  await expect(historial.getByText(`Pedido #${orderNumber}`).first()).toBeVisible({ timeout: 15_000 });
  await shot(page, `e4-${TABLE}-10-historial`);
});
