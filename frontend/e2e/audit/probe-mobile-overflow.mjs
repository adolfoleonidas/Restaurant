// Diagnóstico: por qué /salon expande el viewport de layout en móvil (Pixel 5).
import { chromium, devices } from '@playwright/test';

const BASE = process.env.AUDIT_BASE || 'http://localhost:3001';
const MOZO = { email: 'mozo.test@example.com', password: 'test1234' };
const ROUTES = process.env.AUDIT_ROUTES ? process.env.AUDIT_ROUTES.split(',') : ['/salon', '/cocina', '/caja', '/pedidos', '/dashboard'];

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['Pixel 5'], locale: 'es-PE', timezoneId: 'America/Lima' });
const page = await context.newPage();

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.locator('[data-testid="login-email-input"]').fill(MOZO.email);
await page.locator('[data-testid="login-password-input"]').fill(MOZO.password);
await page.locator('[data-testid="login-submit-button"]').click();
await page.waitForSelector('[data-testid="logout-button"]', { timeout: 25000 });

for (const route of ROUTES) {
  await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const out = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vv = window.visualViewport;
    const visual = vv ? Math.round(vv.width) : vw;
    const wide = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > visual + 1 || r.width > visual + 1 || r.left < -1) {
        const s = getComputedStyle(el);
        wide.push({
          tag: el.tagName.toLowerCase(),
          testid: el.getAttribute('data-testid') || '',
          cls: String(el.className).slice(0, 90),
          left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
          pos: s.position, minW: s.minWidth, overflowX: s.overflowX, display: s.display,
          scrollW: el.scrollWidth, clientW: el.clientWidth,
        });
      }
    }
    const widest = [...wide].sort((a, b) => b.w - a.w);
    // Solo los "contenedores" (los que no están dentro de otro ya listado) y el
    // ancho computado de la raíz ayudan a encontrar al culpable.
    const rootInfo = {
      htmlWidth: Math.round(document.documentElement.getBoundingClientRect().width),
      htmlMinWidth: getComputedStyle(document.documentElement).minWidth,
      bodyWidth: Math.round(document.body.getBoundingClientRect().width),
      bodyMinWidth: getComputedStyle(document.body).minWidth,
      bodyOverflowX: getComputedStyle(document.body).overflowX,
      rootChild: (() => {
        const c = document.getElementById('root');
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { w: Math.round(r.width), scrollW: c.scrollWidth, overflowX: getComputedStyle(c).overflowX };
      })(),
      scrollers: Array.from(document.querySelectorAll('body *'))
        .filter((el) => el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0)
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          testid: el.getAttribute('data-testid') || '',
          cls: String(el.className).slice(0, 70),
          clientW: el.clientWidth, scrollW: el.scrollWidth,
        }))
        .sort((a, b) => (b.scrollW - b.clientW) - (a.scrollW - a.clientW))
        .slice(0, 8),
    };
    return {
      innerW: vw,
      innerH: window.innerHeight,
      visualW: visual,
      visualScale: vv ? Number(vv.scale.toFixed(3)) : null,
      scrollW: document.documentElement.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
      widest: widest.slice(0, 12),
      widestCount: wide.length,
      rootInfo,
    };
  });
  console.log(`\n=== ${route} ===`);
  console.log(`innerW=${out.innerW} innerH=${out.innerH} visualW=${out.visualW} scale=${out.visualScale} scrollW=${out.scrollW} bodyScrollW=${out.bodyScrollW} elementos_desbordados=${out.widestCount}`);
  console.log('  raíz:', JSON.stringify(out.rootInfo));
  for (const w of out.widest) {
    console.log(`  w=${w.w} right=${w.right} scrollW=${w.scrollW} clientW=${w.clientW} ${w.tag}${w.testid ? `[${w.testid}]` : ''} pos=${w.pos} minW=${w.minW} ovf=${w.overflowX} cls=${w.cls}`);
  }
}

await browser.close();
