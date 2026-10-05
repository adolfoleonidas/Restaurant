// Interaction / flow audit for the POS.
//
// The page sweep (capture.mjs) records how each screen looks; this script
// records what it is like to *operate*: validation messages, dialog structure,
// keyboard escapes, tap counts and the critical cobro (checkout) path.
//
// It is deliberately non-destructive: it opens dialogs and walks the cobro
// dialog up to (but not including) the final confirmation, so no money is
// registered and no order changes state.
//
//   node e2e/audit/flows.mjs

import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { INIT_SCRIPT, mkdirp } from './lib.mjs';

const CDP = process.env.AUDIT_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const OUT = path.resolve('e2e', 'audit', 'out');
const SHOTS = path.join(OUT, 'flows');

const USERS = {
  admin: { email: 'admin@resto.com', password: 'admin123' },
  cajero: { email: 'cajero.test@example.com', password: 'test1234' },
};

const VIEWPORTS = [
  { id: 'desktop', width: 1440, height: 900, mobile: false, hasTouch: false },
  { id: 'mobile', width: 390, height: 844, mobile: true, hasTouch: true },
];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function mkLogger(stepLog) {
  return {
    consoleErrors: [],
    pageErrors: [],
    attach(page) {
      this._onConsole = (m) => { if (m.type() === 'error') this.consoleErrors.push(m.text().slice(0, 220)); };
      this._onPageError = (e) => this.pageErrors.push(String(e).slice(0, 220));
      page.on('console', this._onConsole);
      page.on('pageerror', this._onPageError);
    },
    detach(page) {
      page.off('console', this._onConsole);
      page.off('pageerror', this._onPageError);
    },
    reset() { this.consoleErrors = []; this.pageErrors = []; },
    snapshot() { return { consoleErrors: this.consoleErrors.slice(0, 5), pageErrors: this.pageErrors.slice(0, 5) }; },
  };
}

async function describeElement(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    return {
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      name: (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || '').trim().slice(0, 50),
      testid: el.getAttribute('data-testid') || '',
      hasVisibleFocusRing: (() => {
        const s = getComputedStyle(el);
        return Boolean(s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
      })(),
    };
  });
}

async function describeDialogs(page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]'));
    return nodes.map((d) => {
      const labelledBy = d.getAttribute('aria-labelledby');
      const label = labelledBy ? (document.getElementById(labelledBy) || {}).textContent || '' : '';
      const focusables = d.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
      return {
        role: d.getAttribute('role') || 'dialog',
        ariaModal: d.getAttribute('aria-modal'),
        testid: d.getAttribute('data-testid') || '',
        title: label.trim().slice(0, 80),
        firstHeading: (d.querySelector('h1,h2,h3') || {}).textContent?.trim().slice(0, 80) || '',
        focusables: focusables.length,
        focusInside: d.contains(document.activeElement),
        closeButtons: Array.from(d.querySelectorAll('button')).map((b) => (b.getAttribute('aria-label') || b.innerText || '').trim().slice(0, 30)).filter(Boolean).slice(0, 8),
        rect: (() => { const r = d.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
      };
    });
  });
}

async function autoScrollShot(page, file) {
  // Full-page screenshots of very long screens are unusable in a report;
  // keep the viewport shot plus a full-page one for the record.
  await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
}

// ---------------------------------------------------------------------------
// flow definitions
// ---------------------------------------------------------------------------

const FLOWS = [
  {
    id: 'login',
    role: 'anon',
    label: 'Login del personal',
    steps: [
      {
        name: '01-login-inicial',
        note: 'Pantalla de entrada',
        run: async (page) => {
          await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(1200);
          return {
            h1: await page.locator('h1, h2').first().innerText().catch(() => ''),
            fields: await page.locator('input').count(),
            links: await page.locator('a').allInnerTexts().catch(() => []),
            demoCredentialsShown: /admin@resto\.com|test1234|demo/i.test(await page.locator('body').innerText().catch(() => '')),
          };
        },
      },
      {
        name: '02-validacion-vacia',
        note: 'Enviar el formulario vacío',
        run: async (page) => {
          await page.locator('[data-testid="login-submit-button"]').click();
          await page.waitForTimeout(1500);
          const messages = await page.evaluate(() => Array.from(document.querySelectorAll('[role="alert"], .text-destructive, [aria-invalid="true"], .error'))
            .map((e) => ({ text: (e.innerText || e.textContent || '').trim().slice(0, 120), role: e.getAttribute('role') || '', ariaLive: e.getAttribute('aria-live') || '' }))
            .filter((m) => m.text));
          const invalid = await page.locator('[aria-invalid="true"]').count();
          return { messages, ariaInvalidCount: invalid, stayedOnLogin: page.url().includes('/login') };
        },
      },
      {
        name: '03-credenciales-incorrectas',
        note: 'Contraseña equivocada',
        run: async (page) => {
          await page.locator('[data-testid="login-email-input"]').fill('admin@resto.com');
          await page.locator('[data-testid="login-password-input"]').fill('clave-mala-123');
          await page.locator('[data-testid="login-submit-button"]').click();
          await page.waitForTimeout(3000);
          const body = await page.locator('body').innerText().catch(() => '');
          return { errorShown: body.slice(0, 500), stayedOnLogin: page.url().includes('/login') };
        },
      },
      {
        name: '04-orden-de-tabulacion',
        note: 'Recorrido con Tab y visibilidad del foco',
        run: async (page) => {
          await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(1000);
          await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
          const order = [];
          for (let i = 0; i < 10; i += 1) {
            await page.keyboard.press('Tab');
            await page.waitForTimeout(120);
            order.push(await describeElement(page));
          }
          return { tabOrder: order, withoutFocusRing: order.filter((o) => o && !o.hasVisibleFocusRing).length };
        },
      },
      {
        name: '05-login-exitoso',
        note: 'Entrada correcta',
        run: async (page) => {
          await page.locator('[data-testid="login-email-input"]').fill('admin@resto.com');
          await page.locator('[data-testid="login-password-input"]').fill('admin123');
          await page.locator('[data-testid="login-submit-button"]').click();
          await page.waitForSelector('[data-testid="logout-button"]', { timeout: 20000 });
          await page.waitForTimeout(2000);
          return { landedOn: new URL(page.url()).pathname, navigations: await page.locator('nav a').count() };
        },
      },
      {
        name: '06-primera-impresion',
        note: 'A dónde llega el admin tras entrar',
        run: async (page) => {
          await page.waitForTimeout(1500);
          return {
            path: new URL(page.url()).pathname,
            headings: await page.locator('h1, h2, h3').allInnerTexts().catch(() => []),
            navLabels: await page.locator('nav a').allInnerTexts().catch(() => []),
          };
        },
      },
    ],
  },
  {
    id: 'publico',
    role: 'anon',
    label: 'Carta pública y checkout',
    steps: [
      {
        name: '01-menu',
        note: 'Carta pública',
        run: async (page) => {
          await page.goto(`${BASE}/menu`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(2000);
          return {
            productCards: await page.locator('[data-testid^="landing-product-"]').count(),
            addButtons: await page.locator('[data-testid^="landing-add-"]').count(),
          };
        },
      },
      {
        name: '02-agregar-al-carrito',
        note: 'Primer toque: agregar un plato',
        run: async (page) => {
          const add = page.locator('[data-testid^="landing-add-"]').first();
          const count = await add.count();
          if (!count) return { skipped: 'no hay productos con botón de agregar' };
          await add.click({ timeout: 8000 });
          await page.waitForTimeout(1500);
          const cart = page.locator('[data-testid="public-cart-button"]');
          return { cartVisible: await cart.count(), cartText: await cart.innerText().catch(() => '') };
        },
      },
      {
        name: '03-panel-carrito',
        note: 'Abrir el carrito',
        run: async (page) => {
          const btn = page.locator('[data-testid="public-cart-button"]');
          if (!(await btn.count())) return { skipped: 'sin carrito' };
          await btn.first().click({ timeout: 8000 });
          await page.waitForTimeout(1500);
          return { dialogs: await describeDialogs(page), bodySnippet: (await page.locator('body').innerText().catch(() => '')).slice(0, 300) };
        },
      },
      {
        name: '04-checkout',
        note: 'Ir a pagar',
        run: async (page) => {
          const go = page.locator('[data-testid="cart-checkout-button"]');
          if (!(await go.count())) return { skipped: 'sin botón de checkout' };
          await go.first().click({ timeout: 8000 });
          await page.waitForTimeout(2500);
          return { path: new URL(page.url()).pathname, campos: await page.locator('input, select, textarea').count() };
        },
      },
      {
        name: '05-validacion-checkout',
        note: 'Confirmar sin datos',
        run: async (page) => {
          const submit = page.locator('[data-testid="checkout-confirmar-button"]');
          if (!(await submit.count())) return { skipped: 'no estamos en checkout' };
          const disabled = await submit.first().isDisabled();
          if (disabled) return { submitDisabled: true, note: 'el botón ya está deshabilitado: no hay validación que capturar' };
          await submit.first().click({ timeout: 8000 });
          await page.waitForTimeout(2500);
          const messages = await page.evaluate(() => Array.from(document.querySelectorAll('[role="alert"], .text-destructive, [aria-invalid="true"]'))
            .map((e) => (e.innerText || '').trim().slice(0, 120)).filter(Boolean));
          return { messages, path: new URL(page.url()).pathname };
        },
      },
    ],
  },
  {
    id: 'cobro',
    role: 'cajero',
    label: 'Cobro en caja',
    steps: [
      {
        name: '01-caja-inicial',
        note: 'Estado de la caja',
        run: async (page) => {
          await page.goto(`${BASE}/caja`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(3000);
          const body = await page.locator('body').innerText().catch(() => '');
          return {
            headings: await page.locator('h1, h2, h3').allInnerTexts().catch(() => []),
            cobrarButtons: await page.locator('[data-testid^="caja-cobrar-"]').count(),
            abrirCaja: await page.locator('[data-testid="caja-apertura-submit"]').count(),
            bodySnippet: body.slice(0, 400),
          };
        },
      },
      {
        name: '02-abrir-cobro',
        note: 'Abrir el diálogo de cobro (primer toque)',
        run: async (page) => {
          const btn = page.locator('[data-testid^="caja-cobrar-"]').first();
          if (!(await btn.count())) return { skipped: 'no hay cuentas por cobrar' };
          await btn.click({ timeout: 8000 });
          await page.waitForTimeout(2000);
          return { dialogs: await describeDialogs(page), metodos: await page.locator('[data-testid^="caja-metodo-"]').allInnerTexts().catch(() => []) };
        },
      },
      {
        name: '03-metodo-efectivo',
        note: 'Elegir efectivo (segundo toque)',
        run: async (page) => {
          const cash = page.locator('[data-testid="caja-metodo-efectivo"]');
          if (!(await cash.count())) return { skipped: 'sin diálogo de cobro abierto' };
          await cash.first().click({ timeout: 8000 });
          await page.waitForTimeout(1500);
          return {
            keypad: await page.locator('[data-testid^="caja-metodo-"]').count(),
            recibidoInput: await page.locator('[data-testid="caja-recibido-input"]').count(),
            quickAmounts: await page.locator('.cobro-checkout button').allInnerTexts().catch(() => []),
          };
        },
      },
      {
        name: '04-monto-recibido',
        note: 'Escribir el efectivo recibido (tercer toque)',
        run: async (page) => {
          const input = page.locator('[data-testid="caja-recibido-input"]');
          if (!(await input.count())) return { skipped: 'sin campo de efectivo recibido' };
          await input.first().fill('100');
          await page.waitForTimeout(1200);
          return {
            vuelto: await page.locator('[data-testid="caja-vuelto"]').innerText().catch(() => ''),
            total: await page.locator('[data-testid="caja-total"]').innerText().catch(() => ''),
          };
        },
      },
      {
        name: '05-confirmar-cobro',
        note: 'Botón de registrar (cuarto toque)',
        run: async (page) => {
          const submit = page.locator('[data-testid="caja-cobrar-submit-button"]');
          if (!(await submit.count())) return { skipped: 'sin submit' };
          await submit.first().click({ timeout: 8000 });
          await page.waitForTimeout(1800);
          return {
            dialogs: await describeDialogs(page),
            verificacionVisible: await page.locator('[data-testid="caja-verificar-check"]').count(),
            textoSnippet: (await page.locator('body').innerText().catch(() => '')).slice(-600),
          };
        },
      },
      {
        name: '06-cerrar-sin-cobrar',
        note: 'Escape: ¿se puede salir sin cobrar?',
        run: async (page) => {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(1200);
          return { dialogsAfterEscape: await describeDialogs(page), path: new URL(page.url()).pathname };
        },
      },
    ],
  },
  {
    id: 'admin',
    role: 'admin',
    label: 'Diálogos de administración',
    steps: [
      {
        name: '01-productos-dialogo',
        note: 'Alta de producto',
        run: async (page) => {
          await page.goto(`${BASE}/productos`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(2500);
          const newBtn = page.getByRole('button', { name: /nuev[oa]/i }).first();
          const found = await newBtn.count();
          if (!found) return { skipped: 'sin botón de nuevo producto' };
          const name = await newBtn.innerText().catch(() => '');
          await newBtn.click({ timeout: 8000 });
          await page.waitForTimeout(1800);
          return { buttonName: name.trim(), dialogs: await describeDialogs(page), campos: await page.locator('[role="dialog"] input, [role="dialog"] select, [role="dialog"] textarea').count() };
        },
      },
      {
        name: '02-cierre-con-escape',
        note: 'Cerrar el diálogo con Escape',
        run: async (page) => {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(1200);
          return { dialogsAfterEscape: await describeDialogs(page) };
        },
      },
      {
        name: '03-configuracion-tabs',
        note: 'Pestañas de configuración',
        run: async (page) => {
          await page.goto(`${BASE}/configuracion`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(3000);
          const tabs = await page.locator('[role="tab"]').allInnerTexts().catch(() => []);
          const out = { tabs };
          if (tabs.length) {
            await page.locator('[role="tab"]').nth(Math.min(1, tabs.length - 1)).click({ timeout: 6000 }).catch(() => {});
            await page.waitForTimeout(1500);
            out.secondTabHeadings = await page.locator('h2, h3').allInnerTexts().catch(() => []);
          }
          return out;
        },
      },
      {
        name: '04-reset-peligroso',
        note: 'Diálogo de restablecer datos (no se confirma)',
        run: async (page) => {
          const btn = page.locator('[data-testid="data-reset-button"]');
          if (!(await btn.count())) return { skipped: 'sin botón de reset' };
          await btn.first().click({ timeout: 8000 });
          await page.waitForTimeout(1800);
          return {
            dialogs: await describeDialogs(page),
            confirmHint: await page.locator('[data-testid="data-reset-confirm"]').getAttribute('placeholder').catch(() => ''),
            submitDisabled: await page.locator('[data-testid="data-reset-confirm-button"]').isDisabled().catch(() => null),
          };
        },
      },
      {
        name: '05-reportes',
        note: 'Reportes y filtros de fecha',
        run: async (page) => {
          await page.goto(`${BASE}/reportes`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(3500);
          return {
            charts: await page.locator('.recharts-wrapper, svg.recharts-surface').count(),
            headings: await page.locator('h1, h2, h3').allInnerTexts().catch(() => []),
            buttons: await page.locator('button').allInnerTexts().catch(() => []),
          };
        },
      },
      {
        name: '06-local-gestion',
        note: 'Gestión de zonas y mesas',
        run: async (page) => {
          await page.goto(`${BASE}/local`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(3000);
          return {
            headings: await page.locator('h1, h2, h3').allInnerTexts().catch(() => []),
            tabs: await page.locator('[role="tab"]').allInnerTexts().catch(() => []),
            rows: await page.locator('[data-testid^="mesa-qr-controls-"]').count(),
            tableCount: await page.locator('table tr').count(),
          };
        },
      },
      {
        name: '07-usuarios',
        note: 'Equipo',
        run: async (page) => {
          await page.goto(`${BASE}/usuarios`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(2500);
          const newBtn = page.getByRole('button', { name: /nuev[oa]|invitar|agregar/i }).first();
          const found = await newBtn.count();
          if (!found) return { skipped: 'sin botón de nuevo usuario', headings: await page.locator('h1,h2,h3').allInnerTexts().catch(() => []) };
          await newBtn.click({ timeout: 8000 });
          await page.waitForTimeout(1500);
          const out = { dialogs: await describeDialogs(page), campos: await page.locator('[role="dialog"] input, [role="dialog"] select').count() };
          await page.keyboard.press('Escape');
          return out;
        },
      },
      {
        name: '08-disponibilidad',
        note: 'Agotar platos (vista cocina)',
        run: async (page) => {
          await page.goto(`${BASE}/disponibilidad`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(2500);
          return {
            headings: await page.locator('h1, h2, h3').allInnerTexts().catch(() => []),
            rows: await page.locator('[data-testid^="disp-"]').count(),
            switches: await page.locator('button[role="switch"], input[type="checkbox"]').count(),
          };
        },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------

async function loginAs(context, role) {
  const page = await context.newPage();
  const u = USERS[role];
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="login-email-input"]').fill(u.email);
  await page.locator('[data-testid="login-password-input"]').fill(u.password);
  await page.locator('[data-testid="login-submit-button"]').click();
  await page.waitForSelector('[data-testid="logout-button"]', { timeout: 25000 });
  await page.close();
}

async function main() {
  mkdirp(SHOTS);
  const browser = await chromium.connectOverCDP(CDP);
  const results = [];
  const startedAt = new Date().toISOString();

  for (const vp of VIEWPORTS) {
    for (const flow of FLOWS) {
      if (flow.skipViewports && flow.skipViewports.includes(vp.id)) continue;
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.mobile,
        hasTouch: vp.hasTouch,
        deviceScaleFactor: 1,
        locale: 'es-PE',
        timezoneId: 'America/Lima',
      });
      await context.addInitScript(INIT_SCRIPT);
      let loggedIn = null;
      if (flow.role !== 'anon') {
        try {
          await loginAs(context, flow.role);
          loggedIn = true;
        } catch (e) {
          loggedIn = String(e).slice(0, 160);
        }
      }
      const page = await context.newPage();
      const logger = mkLogger();
      logger.attach(page);
      const flowOut = { flow: flow.id, label: flow.label, role: flow.role, viewport: vp.id, loggedIn, steps: [] };

      if (loggedIn !== true && flow.role !== 'anon') {
        flowOut.error = `login falló: ${loggedIn}`;
        results.push(flowOut);
        await context.close();
        continue;
      }

      for (const step of flow.steps) {
        logger.reset();
        const t0 = Date.now();
        let data = null;
        let error = null;
        try {
          data = await step.run(page);
        } catch (e) {
          error = String(e).slice(0, 250);
        }
        const elapsed = Date.now() - t0;
        const shotDir = mkdirp(path.join(SHOTS, vp.id, flow.id));
        const shot = path.join(shotDir, `${step.name}.png`);
        try {
          await autoScrollShot(page, shot);
        } catch (_) { /* ignore */ }
        const stepOut = {
          step: step.name,
          note: step.note,
          elapsed,
          error,
          data,
          ...logger.snapshot(),
          shot: path.relative(OUT, shot).replace(/\\/g, '/'),
        };
        flowOut.steps.push(stepOut);
        console.log(`[${vp.id}] ${flow.id}/${step.name} ${elapsed}ms ${error ? 'ERROR ' + error : ''} ${stepOut.consoleErrors.length ? 'console:' + stepOut.consoleErrors.length : ''}`);
      }
      logger.detach(page);
      results.push(flowOut);
      await context.close();
    }
  }

  const report = { startedAt, finishedAt: new Date().toISOString(), base: BASE, flows: results };
  fs.writeFileSync(path.join(OUT, 'flows.json'), JSON.stringify(report, null, 1));
  console.log(`\nflows=${results.length} -> ${path.join(OUT, 'flows.json')}`);
}

await main();
