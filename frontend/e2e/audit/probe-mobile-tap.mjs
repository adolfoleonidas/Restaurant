// Diagnóstico puntual: por qué un toque sobre una tarjeta de mesa en móvil cae
// en otro elemento. Lanza su propio Chromium (no usa CDP).
//
//   node e2e/audit/probe-mobile-tap.mjs [tableNumber]

import { chromium, devices } from '@playwright/test';

const BASE = process.env.AUDIT_BASE || 'http://localhost:3001';
const TABLE = process.argv[2] || '93286';
const MOZO = { email: 'mozo.test@example.com', password: 'test1234' };

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['Pixel 5'], locale: 'es-PE', timezoneId: 'America/Lima' });
const page = await context.newPage();

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.locator('[data-testid="login-email-input"]').fill(MOZO.email);
await page.locator('[data-testid="login-password-input"]').fill(MOZO.password);
await page.locator('[data-testid="login-submit-button"]').click();
await page.waitForSelector('[data-testid="logout-button"]', { timeout: 25000 });
await page.waitForSelector('[data-testid="salon-root"]', { timeout: 25000 });
await page.waitForTimeout(2500);

const info = await page.evaluate((table) => {
  const sel = `[data-testid="mesa-card-${table}"]`;
  const card = document.querySelector(sel);
  const describe = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      testid: el.getAttribute('data-testid') || el.className.slice(0, 40),
      tag: el.tagName.toLowerCase(),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    };
  };
  if (!card) return { error: `no existe ${sel}` };
  const r = card.getBoundingClientRect();
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const hit = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const owner = el.closest('[data-testid]');
    return {
      element: el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 30),
      ownerTestid: owner ? owner.getAttribute('data-testid') : null,
      insideCard: card.contains(el),
      x: Math.round(x), y: Math.round(y),
    };
  };
  const viewport = { w: window.innerWidth, h: window.innerHeight, scrollY: Math.round(window.scrollY) };
  return {
    viewport,
    card: describe(card),
    filterBar: describe(document.querySelector('[data-testid="salon-filtros"]')),
    zoneBar: describe(document.querySelector('[data-testid="mesas-area-todas"]')),
    legend: describe(document.querySelector('[data-testid="salon-legend"]')),
    grid: describe(card.parentElement),
    hits: {
      center: hit(cx, cy),
      topCenter: hit(cx, r.y + 4),
      bottomCenter: hit(cx, r.bottom - 4),
      leftCenter: hit(r.x + 4, cy),
      rightCenter: hit(r.right - 4, cy),
    },
    otherCards: Array.from(document.querySelectorAll('[data-testid^="mesa-card-"]')).map(describe).slice(0, 8),
  };
}, TABLE);

console.log(JSON.stringify(info, null, 1));

// Reproduce el toque real y reporta si Playwright lo logra.
const click = await page.getByTestId(`mesa-card-${TABLE}`).click({ timeout: 8000 }).then(() => 'ok').catch((e) => String(e).slice(0, 400));
console.log('click:', click);
const sheet = await page.getByTestId('mesa-sheet').isVisible().catch(() => false);
console.log('mesa-sheet visible:', sheet);

await browser.close();
