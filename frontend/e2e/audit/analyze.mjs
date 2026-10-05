// Turns the raw audit JSON into report-ready tables.
//   node e2e/audit/analyze.mjs
// Reads  e2e/audit/out/report.json  (+ flows.json when present)
// Writes e2e/audit/out/summary.md

import fs from 'fs';
import path from 'path';

const OUT = path.resolve('e2e', 'audit', 'out');
const report = JSON.parse(fs.readFileSync(path.join(OUT, 'report.json'), 'utf8'));
let flows = null;
try {
  flows = JSON.parse(fs.readFileSync(path.join(OUT, 'flows.json'), 'utf8'));
} catch (_) { /* optional */ }

const E = report.entries;
const lines = [];
const w = (s = '') => lines.push(s);

const group = (arr, keyFn) => {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
};
const uniq = (a) => Array.from(new Set(a));
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

w('# Resumen automático de la auditoría UI/UX');
w();
w(`- Base auditada: \`${report.base}\` (API \`${report.api}\`)`);
w(`- Inicio: ${report.startedAt} · Fin: ${report.finishedAt}`);
w(`- Visitas capturadas: **${E.length}** en ${report.viewports.length} viewports (${report.viewports.join(', ')})`);
w(`- Descubrimiento de datos: \`${JSON.stringify(report.data)}\``);
const failedLogins = (report.logins || []).filter((l) => !l.ok);
w(`- Logins: ${(report.logins || []).length - failedLogins.length}/${(report.logins || []).length} correctos${failedLogins.length ? ` · FALLOS: ${failedLogins.map((l) => `${l.role}@${l.viewport}`).join(', ')}` : ''}`);
w();

// ---------------------------------------------------------------- console/HTTP
w('## Errores de runtime y HTTP por pantalla');
w();
w('| Pantalla | Viewport | Rol | Errores consola | Errores JS | HTTP ≥400 | Rutas 4xx |');
w('|---|---|---|---|---|---|---|');
const noisy = E.filter((e) => e.consoleErrors.length || e.pageErrors.length || e.failed.length)
  .sort((a, b) => (b.consoleErrors.length + b.pageErrors.length + b.failed.length) - (a.consoleErrors.length + a.pageErrors.length + a.failed.length));
for (const e of noisy.slice(0, 25)) {
  w(`| ${e.route} | ${e.viewport} | ${e.role} | ${e.consoleErrors.length} | ${e.pageErrors.length} | ${e.failed.length} | ${uniq(e.failed.map((f) => `${f.status} ${f.url.split('?')[0]}`)).slice(0, 3).join('<br>')} |`);
}
w();

const allConsole = E.flatMap((e) => e.consoleErrors.map((m) => ({ route: e.route, viewport: e.viewport, m })));
w('### Mensajes de consola más repetidos');
w();
for (const [msg, items] of [...group(allConsole, (x) => x.m.slice(0, 110))].sort((a, b) => b[1].length - a[1].length).slice(0, 12)) {
  w(`- **${items.length}×** \`${msg.replace(/\|/g, '\\|')}\` — ${uniq(items.map((i) => i.route)).slice(0, 6).join(', ')}`);
}
w();

const allFailed = E.flatMap((e) => e.failed.map((f) => ({ route: e.route, viewport: e.viewport, key: `${f.status} ${f.url.split('?')[0]}` })));
w('### Peticiones fallidas más repetidas');
w();
for (const [k, items] of [...group(allFailed, (x) => x.key)].sort((a, b) => b[1].length - a[1].length).slice(0, 12)) {
  w(`- **${items.length}×** \`${k}\` — ${uniq(items.map((i) => i.route)).slice(0, 6).join(', ')}`);
}
w();

// ---------------------------------------------------------------------- axe
const axeAll = E.flatMap((e) => (e.axe || []).filter((v) => v.id !== 'axe-failed').map((v) => ({ ...v, route: e.route, viewport: e.viewport, role: e.role })));
w('## Accesibilidad (axe-core: WCAG 2.0/2.1 A+AA y buenas prácticas)');
w();
w(`Total de violaciones registradas: **${axeAll.reduce((a, v) => a + Math.max(1, v.count), 0)}** en ${E.length} visitas.`);
w();
w('| Regla | Impacto | Nodos | Pantallas afectadas | Viewports |');
w('|---|---|---|---|---|');
const byRule = [...group(axeAll, (v) => v.id)].sort((a, b) => b[1].reduce((s, v) => s + v.count, 0) - a[1].reduce((s, v) => s + v.count, 0));
for (const [id, items] of byRule) {
  const nodes = items.reduce((s, v) => s + v.count, 0);
  w(`| \`${id}\` | ${items[0].impact} | ${nodes} | ${uniq(items.map((i) => i.route)).length} | ${uniq(items.map((i) => i.viewport)).join(', ')} |`);
}
w();
for (const [id, items] of byRule.slice(0, 14)) {
  w(`### \`${id}\` — ${items[0].help}`);
  w();
  w(`Afecta ${uniq(items.map((i) => i.route)).length} pantallas; ejemplo de nodo:`);
  const sample = items.find((i) => i.sample && i.sample.length)?.sample?.[0];
  if (sample) {
    w('```');
    w(`selector: ${sample.target}`);
    w(sample.summary.replace(/<[^>]+>/g, '').slice(0, 400));
    w('```');
  }
  w();
}

// ------------------------------------------------------------------- layout
w('## Layout, legibilidad y objetivos táctiles');
w();
const overflow = E.filter((e) => e.metrics && e.metrics.overflowX > 1).sort((a, b) => b.metrics.overflowX - a.metrics.overflowX);
w(`### Desbordamiento horizontal de página (${overflow.length} visitas)`);
w();
if (overflow.length) {
  w('| Pantalla | Viewport | overflow px | Elementos que se salen |');
  w('|---|---|---|---|');
  for (const e of overflow.slice(0, 20)) {
    const off = e.metrics.offenders.slice(0, 3).map((o) => `\`${o.selector}\` (+${o.overhang}px)`).join('<br>');
    w(`| ${e.route} | ${e.viewport} | ${e.metrics.overflowX} | ${off} |`);
  }
} else w('_Sin desbordamiento horizontal detectado._');
w();

const small = E.filter((e) => e.metrics && e.metrics.smallTargetCountUnder24 > 0)
  .sort((a, b) => b.metrics.smallTargetCountUnder24 - a.metrics.smallTargetCountUnder24);
w('### Objetivos táctiles por debajo de 24×24 px (WCAG 2.5.8)');
w();
w('| Pantalla | Viewport | <24px | <44px | Ejemplos |');
w('|---|---|---|---|---|');
for (const e of small.slice(0, 15)) {
  const ex = e.metrics.smallTargets.filter((t) => t.under24).slice(0, 3).map((t) => `${t.tag} "${t.name}" ${t.w}×${t.h}px`).join('<br>');
  w(`| ${e.route} | ${e.viewport} | ${e.metrics.smallTargetCountUnder24} | ${e.metrics.smallTargetCount} | ${ex} |`);
}
w();
w(`Total de controles <44px contabilizados: **${E.reduce((s, e) => s + (e.metrics?.smallTargetCount || 0), 0)}**; de ellos <24px: **${E.reduce((s, e) => s + (e.metrics?.smallTargetCountUnder24 || 0), 0)}**.`);
w();

const tiny = E.filter((e) => e.metrics && e.metrics.tinyTextCount > 0).sort((a, b) => b.metrics.tinyTextCount - a.metrics.tinyTextCount);
w('### Texto por debajo de 12px');
w();
w(`Visitas afectadas: **${tiny.length}**. Ejemplos:`);
w();
for (const e of tiny.slice(0, 10)) {
  const ex = e.metrics.tinyText.slice(0, 3).map((t) => `"${t.text}" ${t.px}px`).join('<br>');
  w(`- ${e.route} (${e.viewport}): ${e.metrics.tinyTextCount} nodos — ${ex}`);
}
w();

const clipped = E.filter((e) => e.metrics && e.metrics.clippedCount > 0);
w(`### Texto truncado/recortado: ${clipped.length} visitas`);
w();
for (const e of clipped.slice(0, 10)) {
  const ex = e.metrics.clipped.slice(0, 3).map((c) => `"${c.text}" (${c.clientW}<${c.scrollW}px)`).join('<br>');
  w(`- ${e.route} (${e.viewport}): ${e.metrics.clippedCount} — ${ex}`);
}
w();

// -------------------------------------------------------------- structure
w('## Estructura y formularios');
w();
const struct = [
  ['Controles sin nombre accesible', (e) => e.metrics?.namelessCount || 0],
  ['Imágenes sin alt', (e) => e.metrics?.imagesNoAlt?.length || 0],
  ['Campos sin etiqueta', (e) => e.metrics?.inputsNoLabel?.length || 0],
  ['IDs duplicados', (e) => e.metrics?.duplicateIds?.length || 0],
  ['Saltos de jerarquía de encabezados', (e) => e.metrics?.headingJumps?.length || 0],
  ['Conteo de h1 distinto de 1', (e) => (e.metrics && e.metrics.h1Count !== 1 ? 1 : 0)],
  ['Foco dentro de aria-hidden', (e) => e.metrics?.ariaHiddenFocusable || 0],
];
w('| Problema | Visitas afectadas | Peores pantallas |');
w('|---|---|---|');
for (const [label, fn] of struct) {
  const hit = E.map((e) => ({ e, n: fn(e) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  w(`| ${label} | ${hit.length} | ${hit.slice(0, 4).map((h) => `${h.e.route}@${h.e.viewport} (${h.n})`).join(', ')} |`);
}
w();

// ---------------------------------------------------------------- redirects
const redir = E.filter((e) => e.redirected);
w(`## Redirecciones inesperadas: ${redir.length}`);
w();
for (const e of redir.slice(0, 20)) w(`- ${e.role}@${e.viewport}: ${e.requestedPath} → ${e.finalPath}`);
w();
const leaked = E.filter((e) => e.role !== 'anon' && e.loginVisible);
w(`## Sesión perdida (aparece el login estando autenticado): ${leaked.length}`);
w();
for (const e of leaked.slice(0, 20)) w(`- ${e.role}@${e.viewport}: ${e.route}`);
w();

// ------------------------------------------------------------- perf & motion
w('## Rendimiento percibido');
w();
w('| Pantalla | Viewport | asentado ms | FCP ms | load ms | recursos | KB | CLS | long tasks (ms) | nodos DOM |');
w('|---|---|---|---|---|---|---|---|---|---|');
const slow = [...E].sort((a, b) => (b.settleMs || 0) - (a.settleMs || 0));
for (const e of slow.slice(0, 15)) {
  const m = e.metrics || {};
  const p = m.perf || {};
  w(`| ${e.route} | ${e.viewport} | ${e.settleMs} | ${p.fcp ?? ''} | ${p.load ?? ''} | ${p.resources ?? ''} | ${p.transferKB ?? ''} | ${m.cls ?? ''} | ${m.longTaskMs ?? ''} | ${m.domNodes ?? ''} |`);
}
w();
const cls = E.filter((e) => (e.metrics?.cls || 0) > 0.1).sort((a, b) => b.metrics.cls - a.metrics.cls);
w(`### Desplazamiento acumulado (CLS > 0.1): ${cls.length} visitas`);
w();
for (const e of cls.slice(0, 12)) w(`- ${e.route}@${e.viewport}: CLS ${e.metrics.cls} (${e.metrics.shifts.length} desplazamientos)`);
w();
const heavy = E.filter((e) => (e.metrics?.domNodes || 0) > 1500).sort((a, b) => b.metrics.domNodes - a.metrics.domNodes);
w(`### DOM muy grande (>1500 nodos): ${heavy.length} visitas`);
w();
for (const e of heavy.slice(0, 12)) w(`- ${e.route}@${e.viewport}: ${e.metrics.domNodes} nodos, ${e.metrics.scrollables} contenedores con scroll`);
w();

// ------------------------------------------------------------ viewport delta
w('## Comparativa por viewport (misma pantalla)');
w();
const byRoute = group(E, (e) => e.route);
w('| Pantalla | overflowX desktop/tablet/mobile | <24px targets | axe violaciones |');
w('|---|---|---|---|');
for (const [route, items] of byRoute) {
  if (items.length < 2) continue;
  const pick = (vp) => items.find((i) => i.viewport === vp);
  const fmtOverflow = (vp) => { const it = pick(vp); return it?.metrics ? it.metrics.overflowX : '—'; };
  const fmtSmall = (vp) => { const it = pick(vp); return it?.metrics ? it.metrics.smallTargetCountUnder24 : '—'; };
  const axeN = (vp) => { const it = pick(vp); return it ? (it.axe || []).reduce((s, v) => s + v.count, 0) : '—'; };
  w(`| ${route} | ${fmtOverflow('desktop')}/${fmtOverflow('tablet')}/${fmtOverflow('mobile')} | ${fmtSmall('desktop')}/${fmtSmall('tablet')}/${fmtSmall('mobile')} | ${axeN('desktop')}/${axeN('tablet')}/${axeN('mobile')} |`);
}
w();

// -------------------------------------------------------------------- flows
if (flows) {
  w('## Flujos interactivos (qué se probó a mano)');
  w();
  for (const f of flows.flows) {
    w(`### ${f.label} — rol ${f.role} @ ${f.viewport}${f.error ? ` (ERROR: ${f.error})` : ''}`);
    w();
    w('| Paso | ms | Observaciones |');
    w('|---|---|---|');
    for (const s of f.steps) {
      const obs = s.error ? `**ERROR**: ${s.error}` : JSON.stringify(s.data).slice(0, 320);
      w(`| ${s.step} | ${s.elapsed} | ${obs.replace(/\|/g, '\\|')} |`);
    }
    w();
  }
}

fs.writeFileSync(path.join(OUT, 'summary.md'), lines.join('\n'));
console.log(`summary.md escrito: ${lines.length} líneas`);
console.log(`visitas=${E.length} violaciones_axe=${axeAll.length} overflow=${overflow.length} sub24=${small.length}`);
