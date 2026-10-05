// Verificación en vivo del diálogo de cobro (P0-3 del informe): el modal
// comportamiento que antes solo se podía comprobar leyendo el código.
//   node e2e/audit/checks7.mjs
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const CDP = process.env.AUDIT_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.AUDIT_BASE || 'http://localhost:3001';
const OUT = path.resolve('e2e', 'audit', 'out', 'verify');

const browser = await chromium.connectOverCDP(CDP);
for (let i = 0; i < 30; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 2000)); } }

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'es-PE' });
const page = await ctx.newPage();
const out = { pasos: [], problems: [] };

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="login-email-input"]', { timeout: 20000 });
await page.locator('[data-testid="login-email-input"]').fill('cajero.test@example.com');
await page.locator('[data-testid="login-password-input"]').fill('test1234');
await page.locator('[data-testid="login-submit-button"]').click();
await page.waitForSelector('[data-testid="logout-button"]', { timeout: 25000 });

await page.goto(`${BASE}/caja`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
fs.mkdirSync(OUT, { recursive: true });
await page.screenshot({ path: path.join(OUT, 'cobro-01-caja.png') });

const cobrar = page.locator('[data-testid^="caja-cobrar-"]').first();
out.pasos.push({ paso: 'caja', cuentas: await page.locator('[data-testid^="caja-pedido-"]').count(), cobrarVisible: await cobrar.count() });
if (!(await cobrar.count())) { out.problems = ['no hay cuentas por cobrar en /caja']; }
else {
  // 1. el foco está en el botón que abre el diálogo
  const openerName = await cobrar.innerText().catch(() => '');
  await cobrar.click();
  await page.waitForTimeout(1500);
  const dialog = page.locator('[data-testid="caja-cobrar-dialog"]');
  const abierto = await dialog.count();
  await page.screenshot({ path: path.join(OUT, 'cobro-02-dialogo.png') });
  out.pasos.push({ paso: 'dialogo-abierto', abierto, openerName: openerName.trim().slice(0, 30) });

  if (!abierto) out.problems.push('el diálogo de cobro no se abrió');
  else {
    const meta = await dialog.evaluate((el) => ({
      role: el.getAttribute('role'),
      ariaModal: el.getAttribute('aria-modal'),
      labelledby: el.getAttribute('aria-labelledby'),
      title: (document.getElementById(el.getAttribute('aria-labelledby')) || {}).textContent || '',
      focusInside: el.contains(document.activeElement),
      activeTag: document.activeElement ? document.activeElement.tagName.toLowerCase() : null,
      activeTestid: document.activeElement ? document.activeElement.getAttribute('data-testid') : null,
      inertBackground: Array.from(document.body.children).filter((e) => e !== document.documentElement && e.hasAttribute('inert')).length,
    }));
    out.pasos.push({ paso: 'meta-del-dialogo', ...meta });
    if (meta.role !== 'dialog') out.problems.push(`role="${meta.role}" (esperado dialog)`);
    if (meta.ariaModal !== 'true') out.problems.push(`aria-modal="${meta.ariaModal}" (esperado true)`);
    if (!meta.focusInside) out.problems.push('el foco no entró al diálogo al abrirlo');

    // 2. la trampa de foco: 25 tabulaciones no deben salir del diálogo
    let fuera = 0;
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(60);
      const inside = await dialog.evaluate((el) => el.contains(document.activeElement));
      if (!inside) { fuera += 1; break; }
    }
    out.pasos.push({ paso: 'trampa-de-foco', tabulaciones: 25, fueraDeDialogo: fuera });
    if (fuera > 0) out.problems.push('Tab sacó el foco del diálogo en 25 intentos');

    // 3. Escape cierra (no hay cobro en curso)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    const cerrado = await dialog.count();
    await page.screenshot({ path: path.join(OUT, 'cobro-03-escape.png') });
    out.pasos.push({ paso: 'escape', dialogoRestantes: cerrado });
    if (cerrado) out.problems.push('Escape no cerró el diálogo');

    // 4. el foco vuelve al botón que lo abrió
    const foco = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? { tag: el.tagName.toLowerCase(), testid: el.getAttribute('data-testid') || null, text: (el.innerText || '').trim().slice(0, 25) } : null;
    });
    out.pasos.push({ paso: 'retorno-de-foco', foco });
    if (!foco || !/caja-cobrar/.test(foco.testid || '')) out.problems.push(`el foco no volvió al botón de cobro (está en ${JSON.stringify(foco)})`);
  }
}

out.resumen = out.problems.length === 0
  ? 'PASS: el diálogo de cobro se comporta como modal (aria-modal, foco inicial, trampa de foco, Escape, retorno de foco).'
  : `FAIL (${out.problems.length}): ${out.problems.join(' | ')}`;
fs.writeFileSync(path.join(OUT, 'cobro-probe.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
