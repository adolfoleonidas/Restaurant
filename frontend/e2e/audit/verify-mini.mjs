// Verificación puntual del mini-reproductor y la banda "Ahora" en el build real.
//
// Mide lo que el contrato móvil pide y el ojo no puede comprobar en una prueba
// de unidad: que la barra fija no tape la última fila de mesas, que no se solape
// con la barra de navegación inferior y que a 360x640 no aparezca scroll
// horizontal de página.
//
// Uso (desde frontend/, con el build servido en :3001 y Chromium con CDP):
//   node e2e/audit/verify-mini.mjs
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const CDP = process.env.AUDIT_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:3001';
const SHOTS = path.resolve('e2e', 'audit', 'out', 'verify-mini');
const USER = { email: process.env.AUDIT_EMAIL || 'admin@resto.com', password: process.env.AUDIT_PASSWORD || 'admin123' };

fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.connectOverCDP(CDP);
const context = browser.contexts()[0] || await browser.newContext();

async function session(width, height) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  const email = page.locator('[data-testid="login-email-input"]');
  if (await email.count()) {
    await email.fill(USER.email);
    await page.locator('[data-testid="login-password-input"]').fill(USER.password);
    await page.locator('[data-testid="login-submit-button"]').click();
    await page.waitForSelector('[data-testid="logout-button"]', { timeout: 25000 }).catch(() => {});
  }
  await page.goto(`${BASE}/salon`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="salon-root"]', { timeout: 20000 });
  await page.waitForTimeout(2500);
  return page;
}

async function metrics(page) {
  return page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), height: Math.round(r.height) };
    };
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      mini: box('[data-testid="salon-mini"]'),
      nav: box('nav.app-bottom-nav'),
      ahora: box('[data-testid="salon-ahora"]'),
      cards: [...document.querySelectorAll('[data-floor-state]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { testid: el.getAttribute('data-testid'), top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
      }),
      smallTargets: [...document.querySelectorAll('button, a, [role="button"]')]
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { label: (el.getAttribute('data-testid') || el.textContent || '').trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 };
        })
        .filter((t) => t.visible && (t.h < 44 || t.w < 44)),
    };
  });
}

const report = {};
for (const [name, width, height] of [['mobile360', 360, 640], ['mobile', 390, 844], ['desktop', 1440, 900]]) {
  const page = await session(width, height);
  const before = await metrics(page);

  // Abrir la primera mesa con cuenta para que el mini aparezca, y cerrar la hoja.
  const card = page.locator('[data-floor-state]').first();
  if (await card.count()) {
    await card.click();
    await page.waitForTimeout(1500);
    const close = page.locator('[aria-label="Cerrar"]').first();
    if (await close.count()) { await close.click(); await page.waitForTimeout(900); }
  }
  const after = await metrics(page);
  await page.screenshot({ path: path.join(SHOTS, `${name}-salon.png`), fullPage: false });
  await page.screenshot({ path: path.join(SHOTS, `${name}-salon-full.png`), fullPage: true });

  // ¿La barra fija tapa la última fila de mesas con la página al final?
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  const scrolled = await metrics(page);
  await page.screenshot({ path: path.join(SHOTS, `${name}-salon-bottom.png`), fullPage: false });

  const overlapMiniLastCard = after.mini && after.cards.length
    ? after.cards.filter((c) => c.bottom > after.mini.top && c.top < after.mini.bottom).map((c) => c.testid)
    : [];
  const overlapMiniNav = after.mini && after.nav ? after.mini.bottom > after.nav.top : null;
  // Con la página al final, ¿la última tarjeta queda por encima del mini?
  const lastCardAtBottom = scrolled.cards.length ? scrolled.cards[scrolled.cards.length - 1] : null;
  const lastCardHidden = scrolled.mini && lastCardAtBottom ? lastCardAtBottom.bottom > scrolled.mini.top : null;

  report[name] = {
    viewport: after.viewport,
    horizontalOverflowBefore: before.docScrollWidth > before.viewport.w,
    horizontalOverflowAfter: after.docScrollWidth > after.viewport.w,
    mini: after.mini,
    nav: after.nav,
    ahora: after.ahora,
    miniOverlapsBottomNav: overlapMiniNav,
    miniCoversCardsInView: overlapMiniLastCard,
    lastCardBottom: lastCardAtBottom ? lastCardAtBottom.bottom : null,
    miniTopAtBottomScroll: scrolled.mini ? scrolled.mini.top : null,
    lastCardHiddenByMiniAtBottom: lastCardHidden,
    smallTargets: after.smallTargets,
  };
  await page.close();
}

await browser.close();
console.log(JSON.stringify(report, null, 2));
