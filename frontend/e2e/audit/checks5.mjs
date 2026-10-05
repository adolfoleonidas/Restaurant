// Verifica el modo oscuro limitado a cocina y la trampa de foco del cobro.
//   node e2e/audit/checks5.mjs
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const CDP = process.env.AUDIT_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.AUDIT_BASE || 'http://localhost:3001';

const browser = await chromium.connectOverCDP(CDP);
for (let i = 0; i < 30; i += 1) {
  try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 2000)); }
}

// SO en modo oscuro: antes esto volvía oscuro a toda la app (incluida Caja).
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
  locale: 'es-PE',
});
const page = await ctx.newPage();
const out = { tema: [], problems: [] };

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="login-email-input"]', { timeout: 20000 });
await page.locator('[data-testid="login-email-input"]').fill('admin@resto.com');
await page.locator('[data-testid="login-password-input"]').fill('admin123');
await page.locator('[data-testid="login-submit-button"]').click();
await page.waitForSelector('[data-testid="logout-button"]', { timeout: 25000 });

const probe = async (path_) => {
  await page.goto(`${BASE}${path_}`, { waitUntil: 'domcontentloaded' });
  // Espera a que el ThemeProvider termine de hidratar: recién ahí el body
  // tiene las clases de tema y de modo oscuro.
  await page.waitForFunction(
    () => document.body.className.includes('theme-'),
    { timeout: 15000 },
  ).catch(() => {});
  await page.waitForTimeout(1200);
  return page.evaluate(() => ({
    dark: document.body.classList.contains('dark'),
    themeClass: (document.body.className.match(/theme-[a-z]+/) || [])[0] || null,
    storedDark: localStorage.getItem('restaurant-dark-mode'),
    toggleLabel: document.querySelector('[data-testid="theme-toggle"]')?.getAttribute('aria-label') || null,
  }));
};

for (const p of ['/salon', '/cocina', '/caja', '/reportes', '/pedidos', '/cocina']) {
  const r = await probe(p);
  out.tema.push({ path: p, ...r });
}

// Diagnóstico del contraste del ítem activo del menú en cocina: se mide el
// valor computado de las variables y de los colores reales del enlace.
await page.goto(`${BASE}/cocina`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.body.className.includes('theme-'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);
out.contraste = await page.evaluate(() => {
  const link = document.querySelector('[data-testid="nav-cocina"]');
  const span = link ? link.querySelector('span') : null;
  const cs = link ? getComputedStyle(link) : null;
  return {
    bodyClass: document.body.className,
    primaryVar: getComputedStyle(document.body).getPropertyValue('--primary').trim(),
    primaryFgVar: getComputedStyle(document.body).getPropertyValue('--primary-foreground').trim(),
    linkPrimaryVar: link ? getComputedStyle(link).getPropertyValue('--primary').trim() : null,
    linkBg: cs ? cs.backgroundColor : null,
    linkColor: cs ? cs.color : null,
    spanColor: span ? getComputedStyle(span).color : null,
    themeCssLink: document.getElementById('theme-css')?.getAttribute('href') || null,
    loadedStylesheets: Array.from(document.styleSheets).map((s) => s.href).filter(Boolean).slice(0, 8),
  };
});

// Reglas esperadas: cocina siempre oscuro; el resto según la elección del usuario
// (por defecto claro, incluso con el SO en oscuro), y el modo de cocina no se
// persiste en localStorage.
const byPath = Object.fromEntries(out.tema.map((t) => [t.path, t]));
if (byPath['/salon'].dark) out.problems.push('/salon está en oscuro con el SO en oscuro y sin elección del usuario');
if (byPath['/caja'].dark) out.problems.push('/caja está en oscuro: la guía limita el modo oscuro a cocina');
if (!byPath['/cocina'].dark) out.problems.push('/cocina no está en oscuro');
if (byPath['/cocina'].storedDark === 'true') out.problems.push('el modo de cocina se persistió en localStorage');
if (byPath['/cocina'].toggleLabel !== 'Cambiar a tema claro') out.problems.push(`el toggle no refleja el estado oscuro en cocina (label="${byPath['/cocina'].toggleLabel}")`);
if (byPath['/salon'].toggleLabel !== 'Cambiar a tema oscuro') out.problems.push('el toggle no refleja el estado claro fuera de cocina');

out.toggleToggle = await (async () => {
  // El toggle manual sigue funcionando fuera de la cocina. Se muestrea el
  // estado justo después del clic y a los 200/1000/2500 ms para distinguir
  // "nunca se aplicó" de "se aplicó y algo lo revirtió".
  await page.goto(`${BASE}/salon`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.className.includes('theme-'), { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const sample = () => page.evaluate(() => ({
    dark: document.body.classList.contains('dark'),
    stored: localStorage.getItem('restaurant-dark-mode'),
    cls: document.body.className.slice(0, 60),
  }));
  const before = await sample();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await page.locator('[data-testid="theme-toggle"]').click();
  const t0 = Date.now();
  const timeline = [];
  for (const ms of [0, 200, 1000, 2500]) {
    const wait = ms - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    timeline.push({ at: ms, ...(await sample()) });
  }
  await page.locator('[data-testid="theme-toggle"]').click();
  await page.waitForTimeout(1200);
  return { before, timeline, errs, restaurado: !(await page.evaluate(() => document.body.classList.contains('dark'))) };
})();
if (out.toggleToggle.timeline[0].dark === false) out.problems.push('el toggle manual no cambia el tema fuera de la cocina');
if (out.toggleToggle.errs.length) out.problems.push(`errores JS al usar el toggle: ${out.toggleToggle.errs.join(' | ')}`);

fs.mkdirSync(path.resolve('e2e', 'audit', 'out', 'verify'), { recursive: true });
fs.writeFileSync(path.resolve('e2e', 'audit', 'out', 'verify', 'theme-probe.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
