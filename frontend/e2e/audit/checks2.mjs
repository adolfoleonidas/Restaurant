// Verifies the specific UI/UX fixes, one assertion per finding.
//   node e2e/audit/checks2.mjs
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const CDP = process.env.AUDIT_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.AUDIT_BASE || 'http://localhost:3001';
const OUT = path.resolve('e2e', 'audit', 'out', 'verify');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.connectOverCDP(CDP);
const out = {};

const ctxFor = (w, h, mobile) => browser.newContext({
  viewport: { width: w, height: h },
  isMobile: mobile,
  hasTouch: mobile,
  deviceScaleFactor: 1,
  locale: 'es-PE',
});

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="login-email-input"]').fill(email);
  await page.locator('[data-testid="login-password-input"]').fill(password);
  await page.locator('[data-testid="login-submit-button"]').click();
  await page.waitForSelector('[data-testid="logout-button"]', { timeout: 25000 });
}

// ---- 1. login: submit vacío y credenciales incorrectas --------------------
{
  const ctx = await ctxFor(390, 844, true);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.locator('[data-testid="login-submit-button"]').click();
  await page.waitForTimeout(800);
  const empty = {
    alert: await page.locator('[role="alert"]').first().innerText().catch(() => ''),
    ariaInvalid: await page.locator('[aria-invalid="true"]').count(),
  };
  await page.screenshot({ path: path.join(OUT, '01-login-vacio.png') });

  await page.locator('[data-testid="login-email-input"]').fill('admin@resto.com');
  await page.locator('[data-testid="login-password-input"]').fill('clave-mala');
  await page.locator('[data-testid="login-submit-button"]').click();
  await page.waitForTimeout(3000);
  const wrong = {
    alert: await page.locator('[role="alert"]').first().innerText().catch(() => ''),
    stillOnLogin: page.url().includes('/login'),
    toggleName: await page.locator('[data-testid="login-toggle-password"]').getAttribute('aria-label'),
  };
  await page.screenshot({ path: path.join(OUT, '02-login-error.png') });
  out.login = { empty, wrong };
  await ctx.close();
}

// ---- 2. salón: leyenda y desbordamiento ----------------------------------
{
  const ctx = await ctxFor(1024, 768, false);
  const page = await ctx.newPage();
  await login(page, 'admin@resto.com', 'admin123');
  await page.goto(`${BASE}/salon`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const tablet = await page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    legendChips: document.querySelector('[data-testid="salon-legend"]')?.children.length ?? 0,
    legendWidth: Math.round(document.querySelector('[data-testid="salon-legend"]')?.getBoundingClientRect().width ?? 0),
    viewport: window.innerWidth,
  }));
  await page.screenshot({ path: path.join(OUT, '03-salon-tablet.png'), fullPage: false });
  const ctxM = await ctxFor(390, 844, true);
  const pageM = await ctxM.newPage();
  await login(pageM, 'admin@resto.com', 'admin123');
  await pageM.goto(`${BASE}/salon`, { waitUntil: 'domcontentloaded' });
  await pageM.waitForTimeout(3500);
  const mobile = await pageM.evaluate(() => {
    const legend = document.querySelector('[data-testid="salon-legend"]');
    const cs = legend ? getComputedStyle(legend) : null;
    return {
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      legendVisible: Boolean(legend && cs.display !== 'none' && legend.getBoundingClientRect().height > 0),
      legendChips: legend ? legend.children.length : 0,
      cardCta: (() => {
        const b = document.querySelector('[data-testid^="mesa-card-pedir-"], [data-testid^="mesa-card-cobrar-"]');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { h: Math.round(r.height) };
      })(),
      errorBanner: Boolean(document.querySelector('[role="alert"]')),
    };
  });
  await pageM.screenshot({ path: path.join(OUT, '04-salon-mobile.png'), fullPage: false });
  out.salon = { tablet, mobile };
  await ctx.close();
  await ctxM.close();
}

// ---- 3. productos móvil: el botón principal se puede pulsar ---------------
{
  const ctx = await ctxFor(390, 844, true);
  const page = await ctx.newPage();
  await login(page, 'admin@resto.com', 'admin123');
  await page.goto(`${BASE}/productos`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  let clicked = false;
  let dialogTitle = null;
  let error = null;
  try {
    await page.locator('[data-testid="producto-nuevo-button"]').click({ timeout: 8000 });
    clicked = true;
    await page.waitForTimeout(1200);
    dialogTitle = await page.locator('[role="dialog"] h2, [role="dialog"] h1').first().innerText().catch(() => '');
  } catch (e) {
    error = String(e).slice(0, 160);
  }
  await page.screenshot({ path: path.join(OUT, '05-productos-mobile.png') });
  out.productosMobile = { clicked, dialogTitle, error };
  await ctx.close();
}

// ---- 4. diálogo alto en móvil: ¿es alcanzable "Guardar"? ------------------
{
  const ctx = await ctxFor(390, 844, true);
  const page = await ctx.newPage();
  await login(page, 'admin@resto.com', 'admin123');
  await page.goto(`${BASE}/usuarios`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /nuev[oa]/i }).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  out.usuariosDialog = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return { found: false };
    const r = d.getBoundingClientRect();
    const save = Array.from(d.querySelectorAll('button')).find((b) => /guardar/i.test(b.innerText || ''));
    const sr = save ? save.getBoundingClientRect() : null;
    return {
      found: true,
      dialog: { h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) },
      viewportH: window.innerHeight,
      scrollable: d.scrollHeight > d.clientHeight + 1,
      saveVisibleInViewport: sr ? sr.bottom <= window.innerHeight + 1 && sr.top >= -1 : null,
      overflowY: getComputedStyle(d).overflowY,
    };
  });
  await page.screenshot({ path: path.join(OUT, '06-usuarios-dialog-mobile.png') });
  await ctx.close();
}

// ---- 5. pase de cocina: región con scroll accesible ----------------------
{
  const ctx = await ctxFor(1440, 900, false);
  const page = await ctx.newPage();
  await login(page, 'admin@resto.com', 'admin123');
  await page.goto(`${BASE}/cocina`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  out.cocina = await page.evaluate(() => {
    const col = document.querySelector('[data-testid="cocina-columna-listo"] > div');
    if (!col) return { found: false };
    return {
      found: true,
      role: col.getAttribute('role'),
      tabIndex: col.getAttribute('tabindex'),
      ariaLabel: col.getAttribute('aria-label'),
      emptyText: col.innerText.trim().slice(0, 40),
    };
  });
  await page.screenshot({ path: path.join(OUT, '07-cocina.png') });
  await ctx.close();
}

// ---- 6. tema público: sin 401 y con el tema del restaurante --------------
{
  const ctx = await ctxFor(1440, 900, false);
  const page = await ctx.newPage();
  const failures = [];
  page.on('response', (r) => { if (r.status() >= 400) failures.push(`${r.status()} ${r.url().replace(BASE, '')}`); });
  await page.goto(`${BASE}/menu`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  out.publico = {
    failures: failures.slice(0, 6),
    bodyClass: await page.evaluate(() => document.body.className),
    themeCss: await page.evaluate(() => document.getElementById('theme-css')?.getAttribute('href') || null),
  };
  await ctx.close();
}

fs.writeFileSync(path.join(OUT, 'verify.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
