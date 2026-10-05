// Two targeted checks that the page sweep could not settle:
//  1. can `cajero` log in at 390x844 (the flow run timed out waiting for the shell)?
//  2. what intercepts the click on "Nuevo producto" on mobile?
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const CDP = process.env.AUDIT_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const OUT = path.resolve('e2e', 'audit', 'out', 'checks');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.connectOverCDP(CDP);
const results = {};

async function newMobile() {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    locale: 'es-PE',
  });
  return ctx;
}

// ---- 1. cajero login on mobile -------------------------------------------
{
  const ctx = await newMobile();
  const page = await ctx.newPage();
  const console_ = [];
  page.on('console', (m) => { if (m.type() === 'error') console_.push(m.text().slice(0, 200)); });
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.locator('[data-testid="login-email-input"]').fill('cajero.test@example.com');
  await page.locator('[data-testid="login-password-input"]').fill('test1234');
  const before = await page.evaluate(() => ({
    email: document.querySelector('[data-testid="login-email-input"]').value,
    pass: document.querySelector('[data-testid="login-password-input"]').value.length,
    submitRect: (() => { const b = document.querySelector('[data-testid="login-submit-button"]').getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })(),
    submitInViewport: (() => { const b = document.querySelector('[data-testid="login-submit-button"]').getBoundingClientRect(); return b.bottom <= window.innerHeight + 1 && b.top >= -1; })(),
    docHeight: document.documentElement.scrollHeight,
  }));
  await page.locator('[data-testid="login-submit-button"]').click();
  await page.waitForTimeout(6000);
  const after = {
    url: page.url(),
    bodySnippet: (await page.locator('body').innerText().catch(() => '')).slice(0, 240),
    logoutVisible: await page.locator('[data-testid="logout-button"]').isVisible().catch(() => false),
    toast: await page.locator('[data-sonner-toast], [role="status"]').allInnerTexts().catch(() => []),
    consoleErrors: console_.slice(0, 5),
  };
  await page.screenshot({ path: path.join(OUT, 'cajero-login-mobile.png'), fullPage: false });
  results.cajeroLoginMobile = { before, after };
  await ctx.close();
}

// ---- 2. what covers "Nuevo producto" on mobile ----------------------------
{
  const ctx = await newMobile();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="login-email-input"]').fill('admin@resto.com');
  await page.locator('[data-testid="login-password-input"]').fill('admin123');
  await page.locator('[data-testid="login-submit-button"]').click();
  await page.waitForSelector('[data-testid="logout-button"]', { timeout: 25000 });
  await page.goto(`${BASE}/productos`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const probe = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="producto-nuevo-button"]');
    if (!btn) return { found: false };
    const r = btn.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const cs = getComputedStyle(btn);
    const parent = btn.parentElement;
    const pr = parent.getBoundingClientRect();
    return {
      found: true,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      insideViewport: r.right <= window.innerWidth + 1 && r.left >= -1,
      partiallyOffscreen: Math.round(Math.max(0, r.right - window.innerWidth)),
      elementAtCenter: top ? `${top.tagName.toLowerCase()}.${(top.className || '').toString().split(' ').slice(0, 2).join('.')}` : null,
      isTheButtonItself: top === btn || btn.contains(top),
      parentRow: { w: Math.round(pr.width), x: Math.round(pr.x), overflow: Math.round(pr.right - window.innerWidth) },
      pointerEvents: cs.pointerEvents,
      rowChildren: Array.from(parent.children).map((c) => {
        const cr = c.getBoundingClientRect();
        return { tag: c.tagName.toLowerCase(), text: (c.innerText || '').trim().slice(0, 18), x: Math.round(cr.x), right: Math.round(cr.right), w: Math.round(cr.width) };
      }),
      pageOverflowX: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  await page.screenshot({ path: path.join(OUT, 'productos-mobile-header.png'), fullPage: false });
  results.productosMobileButton = probe;
  await ctx.close();
}

fs.writeFileSync(path.join(OUT, 'checks.json'), JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, null, 1));
