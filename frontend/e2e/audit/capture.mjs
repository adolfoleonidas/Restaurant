// UI/UX audit capture harness for the whole system.
//
// Drives the already-running app (default http://localhost:3000) through every
// reachable route, for every role, at three viewports, and records for each
// visit: a full-page screenshot, layout/legibility/touch metrics, an axe-core
// accessibility scan, console errors and failed requests.
//
// Chromium is started outside this script (the sandbox blocks Node from
// spawning it) and attached over CDP.
//
// Usage (from frontend/):
//   node e2e/audit/capture.mjs
//   AUDIT_ROLES=admin AUDIT_VIEWPORTS=desktop node e2e/audit/capture.mjs

import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { INIT_SCRIPT, COLLECT, runAxe, resolveAxePath, mkdirp } from './lib.mjs';

const CDP = process.env.AUDIT_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const API = process.env.AUDIT_API || 'http://localhost:8000/api';
const OUT = path.resolve('e2e', 'audit', 'out');
const SHOTS = path.join(OUT, 'shots');
const AXE = resolveAxePath();

const only = (envName, all) => {
  const raw = process.env[envName];
  if (!raw) return all;
  const wanted = raw.split(',').map((s) => s.trim());
  return all.filter((x) => wanted.includes(x.id || x));
};

const ALL_VIEWPORTS = [
  { id: 'desktop', width: 1440, height: 900, mobile: false, hasTouch: false, label: 'Desktop 1440x900' },
  { id: 'tablet', width: 1024, height: 768, mobile: false, hasTouch: true, label: 'Tablet 1024x768' },
  { id: 'mobile', width: 390, height: 844, mobile: true, hasTouch: true, label: 'Mobile 390x844' },
  // Los dos tamaños que faltaban y que escondían hallazgos reales: 360 px es el
  // Android más estrecho que se usa en el local (ahí desbordaban Pedidos y
  // Usuarios sin que la matriz de 390 px lo viera) y 844x390 es el móvil de
  // lado, donde el formulario de login y el pase de cocina se recortan.
  { id: 'mobile360', width: 360, height: 640, mobile: true, hasTouch: true, label: 'Mobile chico 360x640' },
  { id: 'mobile-landscape', width: 844, height: 390, mobile: true, hasTouch: true, label: 'Mobile apaisado 844x390' },
];

const USERS = {
  admin: { email: 'admin@resto.com', password: 'admin123' },
  mozo: { email: 'mozo.test@example.com', password: 'test1234' },
  cajero: { email: 'cajero.test@example.com', password: 'test1234' },
  cocina: { email: 'cocinero.test@example.com', password: 'test1234' },
};

const PUBLIC_ROUTES = [
  { name: 'landing', path: '/' },
  { name: 'menu', path: '/menu' },
  { name: 'menu-categoria', path: '/menu/categoria/{categoryId}' },
  { name: 'checkout', path: '/checkout' },
  { name: 'login', path: '/login' },
  { name: 'tracking-invalido', path: '/pedido/ZZZZZZZZ' },
  { name: 'tracking-valido', path: '/pedido/{trackingCode}', optional: true },
];

const SHELL_ROUTES = [
  { name: 'dashboard', path: '/dashboard', roles: ['admin', 'mozo', 'cajero', 'cocina'] },
  { name: 'salon', path: '/salon', roles: ['admin', 'mozo', 'cajero'] },
  { name: 'pedidos', path: '/pedidos', roles: ['admin', 'mozo', 'cajero'] },
  { name: 'pedidos-nuevo', path: '/pedidos/nuevo', roles: ['admin', 'mozo'] },
  { name: 'pedido-detalle', path: '/pedidos/{orderId}', roles: ['admin', 'mozo', 'cajero'], optional: true },
  { name: 'cocina', path: '/cocina', roles: ['admin', 'cocina', 'mozo'] },
  { name: 'caja', path: '/caja', roles: ['admin', 'cajero'] },
  { name: 'comprobantes', path: '/comprobantes', roles: ['admin', 'cajero'] },
  { name: 'reportes', path: '/reportes', roles: ['admin'] },
  { name: 'disponibilidad', path: '/disponibilidad', roles: ['admin', 'cocina'] },
  { name: 'productos', path: '/productos', roles: ['admin'] },
  { name: 'combos', path: '/combos', roles: ['admin'] },
  { name: 'categorias', path: '/categorias', roles: ['admin'] },
  { name: 'usuarios', path: '/usuarios', roles: ['admin'] },
  { name: 'pagos', path: '/pagos', roles: ['admin'] },
  { name: 'configuracion', path: '/configuracion', roles: ['admin'] },
  { name: 'local', path: '/local', roles: ['admin'] },
];

// Routes each non-admin role must NOT reach: proves the unauthorized screen.
const FORBIDDEN_PROBES = {
  mozo: { name: 'prohibido-reportes', path: '/reportes' },
  cajero: { name: 'prohibido-productos', path: '/productos' },
  cocina: { name: 'prohibido-caja', path: '/caja' },
};

const DARK_ROUTES = ['salon', 'cocina', 'caja'];

const asArray = (x) => (Array.isArray(x) ? x : (x && (x.items || x.data || x.results)) || []);

async function discover() {
  const out = { categoryId: null, orderId: null, trackingCode: null, notes: [] };
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(USERS.admin),
    });
    if (!res.ok) throw new Error(`admin login ${res.status}`);
    const { access_token: token } = await res.json();
    const get = async (p) => {
      const r = await fetch(API + p, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`${p} -> ${r.status}`);
      return r.json();
    };
    const [cats, orders] = await Promise.all([get('/categories'), get('/orders')]);
    const catList = asArray(cats);
    const orderList = asArray(orders);
    out.categoryId = catList[0]?.id || null;
    const order = orderList.find((o) => o.status !== 'cancelado') || orderList[0];
    out.orderId = order?.id || null;
    out.trackingCode = order?.tracking_code || null;
    out.notes.push(`categories=${catList.length} orders=${orderList.length}`);
  } catch (e) {
    out.notes.push('discovery failed: ' + String(e).slice(0, 160));
  }
  return out;
}

function fillParams(p, data) {
  return p
    .replace('{categoryId}', data.categoryId || '')
    .replace('{orderId}', data.orderId || '')
    .replace('{trackingCode}', data.trackingCode || '');
}

function canVisit(route, data) {
  if (!route.optional) return true;
  if (route.path.includes('{trackingCode}') && !data.trackingCode) return false;
  if (route.path.includes('{orderId}') && !data.orderId) return false;
  if (route.path.includes('{categoryId}') && !data.categoryId) return false;
  return true;
}

async function visit(page, route, meta, data) {
  const target = BASE + fillParams(route.path, data);
  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const failed = [];
  const netLog = [];

  const onConsole = (m) => {
    const t = m.type();
    if (t === 'error') consoleErrors.push(m.text().slice(0, 300));
    else if (t === 'warning') consoleWarnings.push(m.text().slice(0, 200));
  };
  const onPageError = (e) => pageErrors.push(String(e).slice(0, 300));
  const onRequestFailed = (r) => failed.push({ status: 'net', url: r.url().replace(BASE, '').slice(0, 140), err: String(r.failure()?.errorText || '').slice(0, 80) });
  const onResponse = (r) => {
    const s = r.status();
    if (s >= 400 && !r.url().includes('favicon')) failed.push({ status: s, url: r.url().replace(BASE, '').slice(0, 140) });
    if (r.request().resourceType() === 'xhr' || r.request().resourceType() === 'fetch') {
      netLog.push({ m: r.request().method(), u: r.url().replace(API, '').slice(0, 90), s });
    }
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);

  let navError = null;
  const t0 = Date.now();
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    navError = String(e).slice(0, 200);
  }
  // The app polls continuously, so `networkidle` rarely fires: bound it hard.
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(describeWait(route.name));
  const settleMs = Date.now() - t0;

  let metrics = null;
  let axe = null;
  try {
    metrics = await page.evaluate(COLLECT);
  } catch (e) {
    metrics = { error: String(e).slice(0, 200) };
  }
  try {
    axe = await runAxe(page, AXE);
  } catch (e) {
    axe = [{ id: 'axe-failed', impact: 'unknown', help: String(e).slice(0, 200), count: 0, sample: [] }];
  }

  const shotDir = mkdirp(path.join(SHOTS, meta.viewport, meta.role));
  const shotPath = path.join(shotDir, `${route.name}${meta.theme === 'dark' ? '-dark' : ''}.png`);
  try {
    await page.screenshot({ path: shotPath, fullPage: true, animations: 'disabled' });
  } catch (e) {
    try {
      await page.screenshot({ path: shotPath, fullPage: false, animations: 'disabled' });
    } catch (_) { /* ignore */ }
  }

  const loginVisible = await page.locator('[data-testid="login-email-input"]').count().then((n) => n > 0).catch(() => false);
  const finalUrl = page.url();
  const redirected = new URL(finalUrl).pathname !== new URL(target).pathname;

  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  page.off('response', onResponse);
  page.off('requestfailed', onRequestFailed);

  const entry = {
    role: meta.role,
    viewport: meta.viewport,
    route: route.name,
    requestedPath: route.path,
    finalPath: new URL(finalUrl).pathname,
    redirected,
    loginVisible,
    theme: meta.theme || 'light',
    settleMs,
    navError,
    consoleErrors,
    consoleWarnings: consoleWarnings.slice(0, 6),
    pageErrors,
    failed: failed.slice(0, 12),
    xhr: netLog.slice(0, 25),
    metrics,
    axe,
    shot: path.relative(OUT, shotPath).replace(/\\/g, '/'),
  };
  const flag = [
    entry.consoleErrors.length ? `console:${entry.consoleErrors.length}` : '',
    entry.pageErrors.length ? `pageerror:${entry.pageErrors.length}` : '',
    entry.failed.length ? `http4xx:${entry.failed.length}` : '',
    metrics && metrics.overflowX > 1 ? `overflowX:${metrics.overflowX}` : '',
    metrics && metrics.smallTargetCountUnder24 ? `tiny-targets:${metrics.smallTargetCountUnder24}` : '',
    axe && axe.length ? `axe:${axe.length}` : '',
  ].filter(Boolean).join(' ');
  console.log(`[${meta.viewport}/${meta.role}] ${route.name} -> ${entry.finalPath} ${settleMs}ms ${flag}`);
  return entry;
}

function describeWait(name) {
  // Board-style screens poll every few seconds; give them time to paint data.
  if (['cocina', 'salon', 'caja', 'comprobantes', 'dashboard', 'pedidos'].includes(name)) return 1600;
  return 800;
}

async function loginAs(context, role) {
  const page = await context.newPage();
  const u = USERS[role];
  const result = { role, ok: false, error: null };
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('[data-testid="login-email-input"]').fill(u.email);
    await page.locator('[data-testid="login-password-input"]').fill(u.password);
    await page.locator('[data-testid="login-submit-button"]').click();
    await page.waitForSelector('[data-testid="logout-button"]', { timeout: 25000 });
    result.ok = true;
  } catch (e) {
    result.error = String(e).slice(0, 200);
  }
  await page.close();
  return result;
}

async function captureAuthError(context) {
  // One deliberate failed login, to freeze the error/validation state.
  const page = await context.newPage();
  const out = { consoleErrors: [], pageErrors: [] };
  page.on('console', (m) => { if (m.type() === 'error') out.consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => out.pageErrors.push(String(e).slice(0, 200)));
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="login-submit-button"]').click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(mkdirp(path.join(SHOTS, 'desktop', 'anon')), 'login-validacion-vacia.png'), fullPage: true });
    await page.locator('[data-testid="login-email-input"]').fill('admin@resto.com');
    await page.locator('[data-testid="login-password-input"]').fill('clave-incorrecta');
    await page.locator('[data-testid="login-submit-button"]').click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(mkdirp(path.join(SHOTS, 'desktop', 'anon')), 'login-error.png'), fullPage: true });
    out.bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 400);
  } catch (e) {
    out.error = String(e).slice(0, 200);
  }
  await page.close();
  return out;
}

async function main() {
  mkdirp(OUT);
  mkdirp(SHOTS);
  const viewports = only('AUDIT_VIEWPORTS', ALL_VIEWPORTS);
  const roleFilter = process.env.AUDIT_ROLES ? process.env.AUDIT_ROLES.split(',').map((s) => s.trim()) : null;
  const data = await discover();
  console.log('discovery:', JSON.stringify(data));

  const browser = await chromium.connectOverCDP(CDP);
  const startedAt = new Date().toISOString();
  const entries = [];
  const logins = [];
  const authError = {};

  // ---- public routes (no session) -----------------------------------------
  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.mobile,
      hasTouch: vp.hasTouch,
      deviceScaleFactor: 1,
      locale: 'es-PE',
      timezoneId: 'America/Lima',
    });
    await context.addInitScript(INIT_SCRIPT);
    const page = await context.newPage();
    for (const route of PUBLIC_ROUTES) {
      if (!canVisit(route, data)) continue;
      entries.push(await visit(page, route, { role: 'anon', viewport: vp.id }, data));
    }
    if (vp.id === 'desktop') authError[vp.id] = await captureAuthError(context);
    await context.close();
  }

  // ---- authenticated roles ------------------------------------------------
  for (const vp of viewports) {
    for (const role of Object.keys(USERS)) {
      if (roleFilter && !roleFilter.includes(role)) continue;
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.mobile,
        hasTouch: vp.hasTouch,
        deviceScaleFactor: 1,
        locale: 'es-PE',
        timezoneId: 'America/Lima',
      });
      await context.addInitScript(INIT_SCRIPT);
      const login = await loginAs(context, role);
      logins.push({ role, viewport: vp.id, ...login });
      if (!login.ok) {
        console.log(`!! login failed for ${role} @ ${vp.id}: ${login.error}`);
        await context.close();
        continue;
      }
      const page = await context.newPage();
      for (const route of SHELL_ROUTES) {
        if (!route.roles.includes(role)) continue;
        if (!canVisit(route, data)) continue;
        entries.push(await visit(page, route, { role, viewport: vp.id }, data));
      }
      const probe = FORBIDDEN_PROBES[role];
      if (probe) entries.push(await visit(page, probe, { role, viewport: vp.id }, data));

      // dark theme pass, desktop only
      if (vp.id === 'desktop') {
        for (const name of DARK_ROUTES) {
          const route = SHELL_ROUTES.find((r) => r.name === name);
          if (!route || !route.roles.includes(role)) continue;
          const dark = await context.newPage();
          await dark.goto(BASE + fillParams(route.path, data), { waitUntil: 'domcontentloaded' });
          await dark.waitForTimeout(1200);
          const toggled = await dark.locator('[data-testid="theme-toggle"]').click({ timeout: 5000 }).then(() => true).catch(() => false);
          if (!toggled) { await dark.close(); continue; }
          await dark.waitForTimeout(1200);
          entries.push(await visit(dark, route, { role, viewport: vp.id, theme: 'dark' }, data));
          await dark.close();
        }
      }
      await context.close();
    }
  }

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    base: BASE,
    api: API,
    axe: path.relative(process.cwd(), AXE),
    data,
    viewports: viewports.map((v) => v.label),
    logins,
    authError,
    entries,
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.log(`\nentries=${entries.length} -> ${path.join(OUT, 'report.json')}`);
}

await main();
