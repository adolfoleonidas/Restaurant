// Sondeo corto: ¿la app renderiza y hidrata en /cocina tras navegar dos veces?
//   node e2e/audit/checks6.mjs
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const CDP = process.env.AUDIT_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.AUDIT_BASE || 'http://localhost:3001';

const browser = await chromium.connectOverCDP(CDP);
for (let i = 0; i < 30; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 2000)); } }

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark', locale: 'es-PE' });
const page = await ctx.newPage();
const errs = [];
const consoleErrs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 240)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 200)); });

const dump = async (label) => page.evaluate(() => ({
  bodyClass: document.body.className,
  rootChildren: document.getElementById('root')?.children.length ?? -1,
  bodyText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 90),
  dark: document.body.classList.contains('dark'),
  navCocina: Boolean(document.querySelector('[data-testid="nav-cocina"]')),
  statusRegions: document.querySelectorAll('[role="status"][aria-live]').length,
}));

const out = { etapas: [], errs: [], consoleErrs: [] };

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="login-email-input"]', { timeout: 20000 });
await page.locator('[data-testid="login-email-input"]').fill('admin@resto.com');
await page.locator('[data-testid="login-password-input"]').fill('admin123');
await page.locator('[data-testid="login-submit-button"]').click();
await page.waitForSelector('[data-testid="logout-button"]', { timeout: 25000 });
await page.waitForTimeout(2500);
out.etapas.push({ etapa: 'tras-login', ...(await dump()) });

for (const p of ['/salon', '/cocina', '/caja', '/cocina']) {
  errs.length = 0; consoleErrs.length = 0;
  await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  out.etapas.push({ etapa: p, ...(await dump()), errs: errs.slice(0, 3), consoleErrs: consoleErrs.slice(0, 3) });
}

// Contraste del ítem activo del menú, con la app ya hidratada.
await page.goto(`${BASE}/cocina`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
out.contraste = await page.evaluate(() => {
  const link = document.querySelector('[data-testid="nav-cocina"]');
  if (!link) return { error: 'sin nav-cocina' };
  const cs = getComputedStyle(link);
  return {
    bodyClass: document.body.className,
    varPrimary: getComputedStyle(document.body).getPropertyValue('--primary').trim(),
    varPrimaryFg: getComputedStyle(document.body).getPropertyValue('--primary-foreground').trim(),
    linkVarPrimary: getComputedStyle(link).getPropertyValue('--primary').trim(),
    linkBg: cs.backgroundColor,
    linkColor: cs.color,
  };
});

fs.mkdirSync(path.resolve('e2e', 'audit', 'out', 'verify'), { recursive: true });
fs.writeFileSync(path.resolve('e2e', 'audit', 'out', 'verify', 'cocina-probe.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
