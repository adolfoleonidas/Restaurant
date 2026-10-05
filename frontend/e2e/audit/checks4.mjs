// Verifica la arquitectura de información del menú y las regiones vivas.
//   node e2e/audit/checks4.mjs
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const CDP = process.env.AUDIT_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.AUDIT_BASE || 'http://localhost:3001';

const USERS = {
  admin: { email: 'admin@resto.com', password: 'admin123' },
  mozo: { email: 'mozo.test@example.com', password: 'test1234' },
  cajero: { email: 'cajero.test@example.com', password: 'test1234' },
  cocina: { email: 'cocinero.test@example.com', password: 'test1234' },
};

const browser = await chromium.connectOverCDP(CDP);

for (let i = 0; i < 30; i += 1) {
  try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 2000)); }
}

const out = { nav: {}, live: {}, problems: [] };

const readNav = (page) => page.evaluate(() => Array.from(document.querySelectorAll('nav a')).map((a) => ({
  href: a.getAttribute('href'),
  text: (a.innerText || '').replace(/\s+/g, ' ').trim(),
  testid: a.getAttribute('data-testid'),
})));

for (const [role, u] of Object.entries(USERS)) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'es-PE' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  const ok = await page.waitForSelector('[data-testid="login-email-input"]', { timeout: 20000 }).then(() => true).catch(() => false);
  if (!ok) { out.problems.push(`${role}: no apareció el formulario de login`); await ctx.close(); continue; }
  await page.locator('[data-testid="login-email-input"]').fill(u.email);
  await page.locator('[data-testid="login-password-input"]').fill(u.password);
  await page.locator('[data-testid="login-submit-button"]').click();
  const landed = await page.waitForSelector('[data-testid="logout-button"]', { timeout: 25000 }).then(() => true).catch(() => false);
  if (!landed) { out.problems.push(`${role}: login no completó`); await ctx.close(); continue; }

  // Cada rol se lee en una pantalla que sí puede abrir (el shell no existe en
  // /unauthorized, que es donde caería cocina en /salon).
  await page.goto(`${BASE}${role === 'cocina' ? '/cocina' : '/salon'}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  const nav = await readNav(page);
  out.nav[role] = nav;

  // --- comprobaciones del menú ---
  const hrefs = nav.map((n) => n.href).filter(Boolean);
  const dupes = hrefs.filter((h, i) => hrefs.indexOf(h) !== i);
  if (dupes.length) out.problems.push(`${role}: destinos duplicados en el menú -> ${uniq(dupes).join(', ')}`);
  const byHref = (h) => nav.find((n) => n.href === h);
  if (role === 'admin') {
    if (!byHref('/pedidos')) out.problems.push('admin: falta "Pedidos" en el menú');
    if (!nav.some((n) => n.testid === 'nav-mi-web')) out.problems.push('admin: falta "Mi página web"');
  }
  if (role === 'cocina') {
    if (!byHref('/cocina')) out.problems.push('cocina: falta "Cocina" en el menú');
    if (!byHref('/disponibilidad')) out.problems.push('cocina: falta "Disponibilidad" en el menú');
    if (nav.length === 0) out.problems.push('cocina: el menú está vacío');
  }
  for (const [href, expected] of [['/configuracion', 'Configuración'], ['/disponibilidad', 'Disponibilidad'], ['/dashboard', 'Hoy']]) {
    const hit = byHref(href);
    if (hit && hit.text !== expected) out.problems.push(`${role}: ${href} se rotula "${hit.text}" y debería ser "${expected}"`);
  }

  // --- regiones vivas ---
  if (['admin', 'cocina'].includes(role)) {
    await page.goto(`${BASE}/cocina`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    out.live[`${role}-cocina`] = await page.evaluate(() => Array.from(document.querySelectorAll('[role="status"][aria-live]')).map((el) => ({
      live: el.getAttribute('aria-live'), text: el.innerText.trim().slice(0, 90), srOnly: el.className.includes('sr-only'),
    })));
  }
  if (['admin', 'mozo', 'cajero'].includes(role)) {
    await page.goto(`${BASE}/salon`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    out.live[`${role}-salon`] = await page.evaluate(() => Array.from(document.querySelectorAll('[role="status"][aria-live]')).map((el) => ({
      live: el.getAttribute('aria-live'), text: el.innerText.trim().slice(0, 90), srOnly: el.className.includes('sr-only'),
    })));
  }
  await ctx.close();
}

function uniq(a) { return Array.from(new Set(a)); }

fs.mkdirSync(path.resolve('e2e', 'audit', 'out', 'verify'), { recursive: true });
fs.writeFileSync(path.resolve('e2e', 'audit', 'out', 'verify', 'nav-probe.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
