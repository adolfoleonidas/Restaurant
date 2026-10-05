// Compara dos corridas del arnés de auditoría y devuelve una tabla de métricas
// sobre el subconjunto comparable (visitas que existen en ambas corridas).
//
//   node e2e/audit/compare.mjs [baseline] [actual]
//
// Por defecto compara out/report-baseline.json contra out/report.json.
import fs from 'fs';
import path from 'path';

const OUT = path.resolve('e2e', 'audit', 'out');
const baselinePath = process.argv[2] || path.join(OUT, 'report-baseline.json');
const currentPath = process.argv[3] || path.join(OUT, 'report.json');

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const A = read(baselinePath);
const B = read(currentPath);

// Clave estable de una visita para poder compararlas entre corridas.
const key = (e) => `${e.role}|${e.viewport}|${e.route}|${e.theme || 'light'}`;

const bMap = new Map(A.entries.map((e) => [key(e), e]));
const shared = B.entries.filter((e) => bMap.has(key(e)));
const onlyNew = B.entries.filter((e) => !bMap.has(key(e)));

const RULES = [
  'meta-viewport',
  'button-name',
  'color-contrast',
  'region',
  'aria-prohibited-attr',
  'page-has-heading-one',
  'landmark-one-main',
  'aria-valid-attr-value',
  'label',
  'scrollable-region-focusable',
  'select-name',
];

const metrics = (entries) => {
  const axe = entries.flatMap((e) => e.axe || []).filter((v) => v.id !== 'axe-failed');
  const nodes = axe.reduce((s, v) => s + Math.max(1, v.count), 0);
  const rules = {};
  for (const id of RULES) rules[id] = axe.filter((v) => v.id === id).reduce((s, v) => s + v.count, 0);
  return {
    visitas: entries.length,
    axe_nodos: nodes,
    axe_instancias: axe.length,
    ...rules,
    visitas_con_consola: entries.filter((e) => (e.consoleErrors || []).length > 0).length,
    visitas_con_4xx: entries.filter((e) => (e.failed || []).some((f) => Number.isInteger(f.status) && f.status >= 400)).length,
    visitas_con_overflowX: entries.filter((e) => (e.metrics?.overflowX || 0) > 1).length,
    controles_lt44: entries.reduce((s, e) => s + (e.metrics?.smallTargetCount || 0), 0),
    controles_lt24: entries.reduce((s, e) => s + (e.metrics?.smallTargetCountUnder24 || 0), 0),
    texto_lt12px: entries.reduce((s, e) => s + (e.metrics?.tinyTextCount || 0), 0),
    CLS_max: Math.max(0, ...entries.map((e) => Number(e.metrics?.cls || 0))),
  };
};

const before = metrics(A.entries);
const after = metrics(B.entries);
const sharedBefore = metrics(shared.map((e) => bMap.get(key(e))));
const sharedAfter = metrics(shared);

const rows = [];
const push = (label, b, a) => {
  const delta = typeof b === 'number' && typeof a === 'number' ? a - b : null;
  rows.push({ label, before: b, after: a, delta, better: delta === null ? '' : (delta < 0 ? 'mejora' : delta > 0 ? 'PEOR' : '=') });
};
for (const [label, k] of [['Visitas medidas', 'visitas'], ['Nodos infractores de axe', 'axe_nodos'], ['Instancias de regla', 'axe_instancias']]) push(label, sharedBefore[k], sharedAfter[k]);
for (const id of RULES) push(`\`${id}\``, sharedBefore[id], sharedAfter[id]);
push('Visitas con errores de consola', sharedBefore.visitas_con_consola, sharedAfter.visitas_con_consola);
push('Visitas con respuesta ≥400', sharedBefore.visitas_con_4xx, sharedAfter.visitas_con_4xx);
push('Visitas con overflowX', sharedBefore.visitas_con_overflowX, sharedAfter.visitas_con_overflowX);
push('Controles <44 px (suma)', sharedBefore.controles_lt44, sharedAfter.controles_lt44);
push('Controles <24 px (suma)', sharedBefore.controles_lt24, sharedAfter.controles_lt24);
push('Nodos de texto <12 px', sharedBefore.texto_lt12px, sharedAfter.texto_lt12px);
push('CLS máximo', sharedBefore.CLS_max, sharedAfter.CLS_max);
void before; void after;

console.log(`Base:   ${path.relative(process.cwd(), baselinePath)} (${A.entries.length} visitas)`);
console.log(`Actual: ${path.relative(process.cwd(), currentPath)} (${B.entries.length} visitas)`);
console.log(`Visitas comparables entre ambas corridas: ${shared.length}${onlyNew.length ? ` (+${onlyNew.length} solo en la corrida actual)` : ''}`);
console.log('');
console.log('## Comparación sobre las visitas compartidas (misma pantalla, mismo rol, mismo viewport)');
console.log('');
console.log('| Métrica | Antes | Después | Δ |');
console.log('|---|---|---|---|');
for (const r of rows) console.log(`| ${r.label} | ${r.before} | ${r.after} | ${r.delta === null ? '' : (r.delta > 0 ? `+${r.delta}` : r.delta) + ` (${r.better})`} |`);
console.log('');
console.log(`Contexto: la corrida baseline tiene ${A.entries.length} visitas (4 roles × 3 viewports) y la actual ${B.entries.length}; los totales de arriba son solo sobre las ${shared.length} visitas que existen en ambas.`);

if (onlyNew.length) {
  console.log('');
  console.log('Visitas nuevas en la corrida actual (no comparables):');
  for (const e of onlyNew) console.log(`- ${e.route}@${e.viewport}/${e.role}${e.theme ? ` (${e.theme})` : ''}`);
}
