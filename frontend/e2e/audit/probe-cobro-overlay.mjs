// Diagnóstico: por qué el overlay del diálogo de cobro intercepta los clics.
//   node e2e/audit/probe-cobro-overlay.mjs
import { chromium } from '@playwright/test';

const BASE = process.env.AUDIT_BASE || 'http://localhost:3001';
const API = process.env.AUDIT_API || 'http://localhost:8001/api';
const CAJERO = { email: 'cajero.test@example.com', password: 'test1234' };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'es-PE' });

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.locator('[data-testid="login-email-input"]').fill(CAJERO.email);
await page.locator('[data-testid="login-password-input"]').fill(CAJERO.password);
await page.locator('[data-testid="login-submit-button"]').click();
await page.waitForSelector('[data-testid="logout-button"]', { timeout: 25000 });
await page.waitForSelector('[data-testid="caja-root"]', { timeout: 25000 });
await page.waitForTimeout(2000);

const cobrar = page.locator('[data-testid^="caja-cobrar-"]').first();
if (!(await cobrar.count())) {
  console.log('no hay cuentas por cobrar; nada que diagnosticar');
  await browser.close();
  process.exit(0);
}
await cobrar.click();
await page.waitForSelector('[data-testid="caja-cobrar-dialog"]', { timeout: 15000 });
await page.waitForTimeout(1200);

// Igual que hace Playwright antes de un click: traer el botón a la vista.
await page.locator('button', { hasText: 'Exacto' }).first().scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(600);

const info = await page.evaluate(() => {
  const describe = (el) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      cls: String(el.className).slice(0, 60),
      testid: el.getAttribute('data-testid') || '',
      state: el.getAttribute('data-state') || '',
      ariaHidden: el.getAttribute('aria-hidden') || '',
      zIndex: s.zIndex, position: s.position, pointerEvents: s.pointerEvents,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      parent: el.parentElement ? String(el.parentElement.className).slice(0, 40) : null,
      parentZ: el.parentElement ? getComputedStyle(el.parentElement).zIndex : null,
      indexInParent: el.parentElement ? Array.from(el.parentElement.children).indexOf(el) : null,
    };
  };
  const overlays = Array.from(document.querySelectorAll('.cobro-overlay'));
  const contents = Array.from(document.querySelectorAll('.cobro-checkout, [data-testid="caja-cobrar-dialog"]'));
  const exacto = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Exacto');
  let stack = [];
  let exactoBox = null;
  if (exacto) {
    const r = exacto.getBoundingClientRect();
    exactoBox = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    stack = document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2).slice(0, 6).map(describe);
  }
  return {
    overlayCount: overlays.length,
    contentCount: contents.length,
    overlays: overlays.map(describe),
    contents: contents.map(describe),
    exactoBox,
    stackAtExactoCenter: stack,
  };
});

console.log(JSON.stringify(info, null, 1));
await browser.close();
