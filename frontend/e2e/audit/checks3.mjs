// Ground truth for the remaining h1 / document.title issues.
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const CDP = process.env.AUDIT_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.AUDIT_BASE || 'http://localhost:3001';

const browser = await chromium.connectOverCDP(CDP);

// El dev server puede estar recompilando (webpack observa frontend/e2e): se
// espera a que vuelva a responder antes de medir.
for (let i = 0; i < 30; i += 1) {
  try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 2000)); }
}

const newCtx = () => browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'es-PE' });

const probe = async (page) => {
  await page.waitForTimeout(2200);
  return page.evaluate(() => ({
    title: document.title,
    h1: Array.from(document.querySelectorAll('h1')).map((h) => h.innerText.trim().slice(0, 40)),
    h2: Array.from(document.querySelectorAll('h2')).map((h) => h.innerText.trim().slice(0, 40)).slice(0, 5),
    path: location.pathname,
  }));
};

async function login(page, email, password) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    const ok = await page.waitForSelector('[data-testid="login-email-input"]', { timeout: 20000 }).then(() => true).catch(() => false);
    if (!ok) { await new Promise((r) => setTimeout(r, 5000)); continue; }
    await page.locator('[data-testid="login-email-input"]').fill(email);
    await page.locator('[data-testid="login-password-input"]').fill(password);
    await page.locator('[data-testid="login-submit-button"]').click();
    const landed = await page.waitForSelector('[data-testid="logout-button"]', { timeout: 25000 }).then(() => true).catch(() => false);
    if (landed) return true;
  }
  return false;
}

const out = {};

// ---- públicas (contexto anónimo) ----
{
  const ctx = await newCtx();
  const page = await ctx.newPage();
  for (const [label, url] of [['login', '/login'], ['checkout-vacio', '/checkout'], ['tracking-invalido', '/pedido/ZZZZZZZZ'], ['landing', '/']]) {
    await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
    out[label] = await probe(page);
  }
  await ctx.close();
}

// ---- cajero: /caja ----
{
  const ctx = await newCtx();
  const page = await ctx.newPage();
  out['_login_cajero'] = await login(page, 'cajero.test@example.com', 'test1234');
  await page.goto(`${BASE}/caja`, { waitUntil: 'domcontentloaded' });
  out['caja-cajero'] = await probe(page);
  await ctx.close();
}

// ---- admin: /caja, /pagos, /pedidos, /reportes ----
{
  const ctx = await newCtx();
  const page = await ctx.newPage();
  out['_login_admin'] = await login(page, 'admin@resto.com', 'admin123');
  for (const [label, url] of [['caja-admin', '/caja'], ['pagos-admin', '/pagos'], ['pedidos-admin', '/pedidos'], ['reportes-admin', '/reportes']]) {
    await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
    out[label] = await probe(page);
  }
  await ctx.close();
}

fs.mkdirSync(path.resolve('e2e', 'audit', 'out', 'verify'), { recursive: true });
fs.writeFileSync(path.resolve('e2e', 'audit', 'out', 'verify', 'h1-probe.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
