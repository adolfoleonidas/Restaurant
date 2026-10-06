// Auditoría de duplicaciones de opciones en la UI.
//
// Recorre cada pantalla de cada rol y busca, con evidencia del DOM:
//   1. opciones repetidas dentro de la misma pantalla o del mismo panel (misma
//      etiqueta en dos controles distintos, o el mismo `data-testid` dos veces);
//   2. `data-testid` e `id` duplicados (síntoma de estructura copiada);
//   3. destinos repetidos en el menú de navegación;
//   4. la misma decisión ofrecida por dos superficies distintas (áreas de venta,
//      métodos de pago), comparando sus conjuntos de opciones;
//   5. opciones repetidas dentro de un `<select>` nativo.
//
// No modifica datos: solo abre y cierra paneles.
//
//   node e2e/audit/duplicates.mjs
//   AUDIT_VIEWPORTS=desktop node e2e/audit/duplicates.mjs

import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const CDP = process.env.AUDIT_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.AUDIT_BASE || 'http://localhost:3001';
const OUT = path.resolve('e2e', 'audit', 'out');
const SHOTS = path.join(OUT, 'duplicates');

const USERS = {
  admin: { email: 'admin@resto.com', password: 'admin123' },
  mozo: { email: 'mozo.test@example.com', password: 'test1234' },
  cajero: { email: 'cajero.test@example.com', password: 'test1234' },
  cocina: { email: 'cocinero.test@example.com', password: 'test1234' },
};

const ALL_VIEWPORTS = [
  { id: 'desktop', width: 1440, height: 900, mobile: false, hasTouch: false },
  { id: 'mobile', width: 390, height: 844, mobile: true, hasTouch: true },
];

// Pantallas por rol (solo rutas que el rol puede abrir).
const SCREENS = {
  admin: ['/dashboard', '/salon', '/pedidos', '/cocina', '/caja', '/comprobantes', '/reportes', '/disponibilidad', '/productos', '/categorias', '/usuarios', '/pagos', '/local', '/configuracion'],
  mozo: ['/dashboard', '/salon', '/pedidos', '/cocina'],
  cajero: ['/dashboard', '/salon', '/pedidos', '/caja', '/comprobantes'],
  cocina: ['/dashboard', '/cocina', '/disponibilidad'],
};

// Paneles que se abren desde cada pantalla. `root` acota el escaneo al panel.
const PANELS = {
  '/salon': [
    { name: 'nuevo-pedido', open: '[data-testid="salon-nuevo-pedido"]', root: '[data-testid="nuevo-pedido-sheet"]', close: 'body' },
    { name: 'mesa-sheet', open: '[data-testid^="mesa-card-"]:not([data-testid*="grupo"]):not([data-testid*="deliver"])', root: '[data-testid="mesa-sheet"]', close: 'body' },
    { name: 'unir-mesas', open: '[data-testid="salon-unir-mesas"]', root: '[data-testid="salon-seleccion"]', close: '[data-testid="salon-seleccion-cancelar"]' },
  ],
  '/pedidos': [
    { name: 'areas-venta', open: '[data-testid="pedidos-nuevo-button"]', root: '[data-testid="areas-venta"]', close: 'body' },
  ],
  '/caja': [
    { name: 'cobrar-dialog', open: '[data-testid^="caja-cobrar-"]', root: '[data-testid="caja-cobrar-dialog"]', close: 'body' },
  ],
  '/productos': [
    { name: 'tab-combos', open: '[data-testid="tab-combos"]', root: 'body', close: 'body' },
  ],
  '/local': [
    { name: 'mesa-form', open: '[data-testid="mesa-config-nueva"]', root: '[role="dialog"]', close: 'body' },
  ],
  '/usuarios': [
    { name: 'alta-usuario', open: 'button:has-text("Nuevo"), button:has-text("Agregar"), button:has-text("Invitar")', root: '[role="dialog"]', close: 'body' },
  ],
};

// Superficies cuyo conjunto de opciones se compara entre sí (misma decisión,
// dos pantallas). Clave: nombre legible; selector: elementos de opción.
const OPTION_SURFACES = [
  { key: 'areas-venta:salon', selector: '[data-testid^="nuevo-pedido-tipo-"]' },
  { key: 'areas-venta:pedidos', selector: '[data-testid^="area-"]' },
  { key: 'metodos-pago:checkout', selector: '[data-testid^="checkout-method-"]' },
  { key: 'metodos-pago:cobro', selector: '[data-testid="caja-cobrar-dialog"] [role="tab"], [data-testid="caja-cobrar-dialog"] .method-rail button' },
];

const SCAN = (rootSelector) => {
  const root = rootSelector ? document.querySelector(rootSelector) : document.body;
  if (!root) return { missingRoot: true, rootSelector };

  const norm = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0;
  };
  const labelOf = (el) => norm(
    el.getAttribute('aria-label') || el.innerText || el.textContent || el.value || el.getAttribute('title') || ''
  ).slice(0, 90);
  const cssPath = (el) => {
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth < 5) {
      let p = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift(p + '#' + cur.id); break; }
      const cls = typeof cur.className === 'string' ? cur.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
      if (cls.length) p += '.' + cls.join('.');
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) p += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(p);
      cur = parent;
      depth += 1;
    }
    return parts.join(' > ');
  };
  const parentKey = (el) => {
    const p = el.parentElement;
    return p ? cssPath(p) : '(sin padre)';
  };

  const CONTROL_SEL = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="option"], option, summary, input[type="radio"], input[type="checkbox"]';
  const controls = Array.from(root.querySelectorAll(CONTROL_SEL)).filter(isVisible).map((el) => {
    const r = el.getBoundingClientRect();
    return {
      label: labelOf(el),
      tag: el.tagName.toLowerCase(),
      testid: el.getAttribute('data-testid') || '',
      id: el.id || '',
      selector: cssPath(el),
      parent: parentKey(el),
      w: Math.round(r.width),
      h: Math.round(r.height),
      type: el.getAttribute('type') || '',
    };
  });

  // --- 1. misma etiqueta en varios controles -------------------------------
  const byLabel = {};
  for (const c of controls) {
    if (!c.label) continue;
    const key = c.label.toLowerCase();
    (byLabel[key] = byLabel[key] || []).push(c);
  }
  const repeated = Object.entries(byLabel)
    .filter(([, v]) => v.length > 1)
    .map(([label, items]) => {
      const testids = Array.from(new Set(items.map((i) => i.testid).filter(Boolean)));
      return {
        label,
        count: items.length,
        testids,
        sameTestid: testids.length === 1 && items.filter((i) => i.testid).length > 1,
        sameParent: new Set(items.map((i) => i.parent)).size === 1,
        allSameType: new Set(items.map((i) => i.type)).size === 1,
        items: items.slice(0, 6).map((i) => ({ tag: i.tag, testid: i.testid, selector: i.selector, w: i.w, h: i.h, type: i.type })),
      };
    })
    .sort((a, b) => Number(b.sameTestid) - Number(a.sameTestid) || Number(b.sameParent) - Number(a.sameParent) || b.count - a.count);

  // --- 2. data-testid e id duplicados -------------------------------------
  const testidMap = {};
  for (const el of Array.from(root.querySelectorAll('[data-testid]'))) {
    const id = el.getAttribute('data-testid');
    (testidMap[id] = testidMap[id] || []).push(cssPath(el));
  }
  const duplicateTestids = Object.entries(testidMap)
    .filter(([, v]) => v.length > 1)
    .map(([testid, selectors]) => ({ testid, count: selectors.length, selectors: selectors.slice(0, 5) }));

  const idMap = {};
  for (const el of Array.from(root.querySelectorAll('[id]'))) {
    (idMap[el.id] = idMap[el.id] || 0) + 0;
    idMap[el.id] += 1;
  }
  const duplicateIds = Object.entries(idMap).filter(([, n]) => n > 1).map(([id, count]) => ({ id, count }));

  // --- 3. menú de navegación ----------------------------------------------
  const nav = Array.from(document.querySelectorAll('nav a')).map((a) => ({
    href: a.getAttribute('href'),
    label: norm(a.innerText),
    testid: a.getAttribute('data-testid') || '',
  }));
  const navHrefs = nav.map((n) => n.href).filter(Boolean);
  const navDuplicateHrefs = Array.from(new Set(navHrefs.filter((h, i) => navHrefs.indexOf(h) !== i)));
  const navLabels = nav.map((n) => n.label).filter(Boolean);
  const navDuplicateLabels = Array.from(new Set(navLabels.filter((l, i) => navLabels.indexOf(l) !== i)));

  // --- 4. conjuntos de opciones -------------------------------------------
  const options = [];
  for (const surface of window.__optionSurfaces || []) {
    const nodes = Array.from(document.querySelectorAll(surface.selector)).filter(isVisible);
    if (!nodes.length) continue;
    options.push({
      key: surface.key,
      labels: nodes.map((n) => labelOf(n)).filter(Boolean),
      testids: nodes.map((n) => n.getAttribute('data-testid') || '').filter(Boolean),
    });
  }

  // --- 5. selects nativos --------------------------------------------------
  const selects = Array.from(root.querySelectorAll('select')).map((s) => {
    const opts = Array.from(s.options).map((o) => ({ label: norm(o.textContent), value: o.value }));
    const labels = opts.map((o) => o.label).filter(Boolean);
    const values = opts.map((o) => o.value).filter(Boolean);
    return {
      testid: s.getAttribute('data-testid') || '',
      name: s.getAttribute('name') || '',
      count: opts.length,
      duplicateLabels: Array.from(new Set(labels.filter((l, i) => labels.indexOf(l) !== i))),
      duplicateValues: Array.from(new Set(values.filter((v, i) => values.indexOf(v) !== i))),
      options: opts.slice(0, 30),
    };
  });

  return {
    url: location.href,
    path: location.pathname,
    rootSelector: rootSelector || 'body',
    controlCount: controls.length,
    repeated,
    duplicateTestids,
    duplicateIds,
    nav: { items: nav, duplicateHrefs: navDuplicateHrefs, duplicateLabels: navDuplicateLabels },
    options,
    selects,
  };
};

function problemsOf(scan) {
  const out = [];
  if (!scan || scan.missingRoot) return out;
  for (const d of scan.duplicateTestids || []) out.push(`data-testid duplicado "${d.testid}" x${d.count} -> ${d.selectors[0]}`);
  for (const d of scan.duplicateIds || []) out.push(`id duplicado "${d.id}" x${d.count}`);
  for (const d of scan.nav.duplicateHrefs || []) out.push(`menú: destino repetido ${d}`);
  for (const d of scan.nav.duplicateLabels || []) out.push(`menú: etiqueta repetida "${d}"`);
  for (const r of scan.repeated || []) {
    if (r.sameTestid) out.push(`opción repetida (mismo testid "${r.testids[0]}") "${r.label}" x${r.count}`);
    else if (r.sameParent && r.allSameType) out.push(`opción repetida en el mismo bloque "${r.label}" x${r.count} [${r.testids.join(', ') || r.items.map((i) => i.tag).join(', ')}]`);
  }
  for (const s of scan.selects || []) {
    for (const l of s.duplicateLabels) out.push(`select ${s.testid || s.name}: opción repetida "${l}"`);
    for (const v of s.duplicateValues) out.push(`select ${s.testid || s.name}: value repetido "${v}"`);
  }
  return out;
}

async function login(context, role) {
  const page = await context.newPage();
  const u = USERS[role];
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('[data-testid="login-email-input"]').fill(u.email);
  await page.locator('[data-testid="login-password-input"]').fill(u.password);
  await page.locator('[data-testid="login-submit-button"]').click();
  await page.waitForSelector('[data-testid="logout-button"]', { timeout: 25000 });
  await page.close();
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const viewports = process.env.AUDIT_VIEWPORTS
    ? ALL_VIEWPORTS.filter((v) => process.env.AUDIT_VIEWPORTS.split(',').map((s) => s.trim()).includes(v.id))
    : ALL_VIEWPORTS;
  const roleFilter = process.env.AUDIT_ROLES ? process.env.AUDIT_ROLES.split(',').map((s) => s.trim()) : Object.keys(USERS);

  const browser = await chromium.connectOverCDP(CDP);
  const startedAt = new Date().toISOString();
  const entries = [];
  let fatal = null;

  try {
  for (const vp of viewports) {
    for (const role of roleFilter) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.mobile,
        hasTouch: vp.hasTouch,
        deviceScaleFactor: 1,
        locale: 'es-PE',
        timezoneId: 'America/Lima',
      });
      await context.addInitScript(`window.__optionSurfaces = ${JSON.stringify(OPTION_SURFACES)};`);
      try {
        await login(context, role);
      } catch (e) {
        console.log(`!! login ${role} @ ${vp.id}: ${String(e).slice(0, 120)}`);
        await context.close();
        continue;
      }
      const page = await context.newPage();

      for (const route of SCREENS[role] || []) {
        try {
          await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e) {
          entries.push({ role, viewport: vp.id, route, error: String(e).slice(0, 160) });
          continue;
        }
        await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(1400);

        let scan = null;
        try {
          scan = await page.evaluate(SCAN, null);
        } catch (e) {
          entries.push({ role, viewport: vp.id, route, surface: 'page', error: String(e).slice(0, 160) });
          continue;
        }
        entries.push({ role, viewport: vp.id, route, surface: 'page', scan, problems: problemsOf(scan) });

        for (const panel of PANELS[route] || []) {
          try {
            const opener = page.locator(panel.open).first();
            const opened = await opener.click({ timeout: 6000 }).then(() => true).catch(() => false);
            if (!opened) {
              entries.push({ role, viewport: vp.id, route, surface: panel.name, problems: [`no se pudo abrir (${panel.open})`] });
              continue;
            }
            await page.waitForTimeout(1200);
            const panelScan = await page.evaluate(SCAN, panel.root).catch((e) => ({ error: String(e).slice(0, 160) }));
            const shot = path.join(SHOTS, `${vp.id}-${role}-${route.replace(/\//g, '_')}-${panel.name}.png`);
            await page.screenshot({ path: shot, fullPage: false, animations: 'disabled' }).catch(() => {});
            entries.push({
              role, viewport: vp.id, route, surface: panel.name, scan: panelScan,
              problems: problemsOf(panelScan),
              shot: path.relative(OUT, shot).replace(/\\/g, '/'),
            });
            // cerrar el panel
            await page.keyboard.press('Escape').catch(() => {});
            await page.waitForTimeout(500);
            if (panel.close && panel.close !== 'body') {
              await page.locator(panel.close).first().click({ timeout: 3000 }).catch(() => {});
            }
          } catch (e) {
            entries.push({ role, viewport: vp.id, route, surface: panel.name, problems: [`panel interrumpido: ${String(e).slice(0, 140)}`] });
          }
          await page.waitForTimeout(300);
        }
      }
      await context.close();
    }
  }
  } catch (e) {
    fatal = String(e).slice(0, 300);
    console.log(`!! auditoría interrumpida: ${fatal}`);
  }

  // --- comparación entre superficies con las mismas opciones ---------------
  const surfaceMap = {};
  for (const e of entries) {
    for (const o of (e.scan && e.scan.options) || []) {
      const key = o.key;
      if (!surfaceMap[key]) surfaceMap[key] = { labels: new Set(), seenIn: new Set(), testids: new Set() };
      o.labels.forEach((l) => surfaceMap[key].labels.add(l.toLowerCase()));
      surfaceMap[key].seenIn.add(`${e.role}/${e.viewport}${e.route}`);
      o.testids.forEach((t) => surfaceMap[key].testids.add(t));
    }
  }
  const surfaceKeys = Object.keys(surfaceMap);
  const crossSurface = [];
  for (let i = 0; i < surfaceKeys.length; i += 1) {
    for (let j = i + 1; j < surfaceKeys.length; j += 1) {
      const a = surfaceMap[surfaceKeys[i]];
      const b = surfaceMap[surfaceKeys[j]];
      const shared = Array.from(a.labels).filter((l) => b.labels.has(l));
      if (shared.length >= 2) {
        crossSurface.push({
          a: surfaceKeys[i], b: surfaceKeys[j],
          labelsA: Array.from(a.labels), labelsB: Array.from(b.labels),
          shared,
          onlyA: Array.from(a.labels).filter((l) => !b.labels.has(l)),
          onlyB: Array.from(b.labels).filter((l) => !a.labels.has(l)),
        });
      }
    }
  }

  const report = {
    startedAt,
    fatal,
    finishedAt: new Date().toISOString(),
    base: BASE,
    viewports: viewports.map((v) => v.id),
    roles: roleFilter,
    entries,
    surfaces: Object.fromEntries(Object.entries(surfaceMap).map(([k, v]) => [k, { labels: Array.from(v.labels), testids: Array.from(v.testids), seenIn: Array.from(v.seenIn) }])),
    crossSurface,
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'duplicates.json'), JSON.stringify(report, null, 1));

  // --- resumen por consola --------------------------------------------------
  console.log(`\n=== duplicaciones (${entries.length} superficies escaneadas) ===`);
  let flagged = 0;
  for (const e of entries) {
    if (!e.problems || !e.problems.length) continue;
    flagged += e.problems.length;
    console.log(`\n[${e.viewport}/${e.role}] ${e.route} · ${e.surface}`);
    for (const p of e.problems) console.log(`   - ${p}`);
  }
  if (crossSurface.length) {
    console.log('\n=== misma decisión en dos superficies ===');
    for (const c of crossSurface) {
      console.log(`\n${c.a}  <->  ${c.b}`);
      console.log(`   comunes: ${c.shared.join(', ')}`);
      console.log(`   solo en ${c.a}: ${c.onlyA.join(', ') || '—'}`);
      console.log(`   solo en ${c.b}: ${c.onlyB.join(', ') || '—'}`);
    }
  }
  console.log(`\ntotal de avisos: ${flagged} -> ${path.join(OUT, 'duplicates.json')}`);
}

await main();
