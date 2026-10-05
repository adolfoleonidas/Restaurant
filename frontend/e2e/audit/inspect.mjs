// Detalle de un hallazgo del reporte de auditoría.
//   node e2e/audit/inspect.mjs [ruta] [regla]
import fs from 'fs';
import path from 'path';

const OUT = path.resolve('e2e', 'audit', 'out');
const report = JSON.parse(fs.readFileSync(path.join(OUT, 'report.json'), 'utf8'));
const routeFilter = process.argv[2];
const ruleFilter = process.argv[3];

for (const e of report.entries) {
  if (routeFilter && !e.route.includes(routeFilter)) continue;
  const rules = (e.axe || []).filter((v) => v.id !== 'axe-failed' && (!ruleFilter || v.id.includes(ruleFilter)));
  const has = rules.length || (ruleFilter && ruleFilter === 'dark');
  if (!has) continue;
  console.log(`--- ${e.route}@${e.viewport}/${e.role}${e.theme ? ` (${e.theme})` : ''}`);
  console.log(`    dark=${e.metrics?.dark} themeClass=${e.metrics?.styles?.body?.fontFamily} overflowX=${e.metrics?.overflowX} tinyText=${e.metrics?.tinyTextCount} smallTargets24=${e.metrics?.smallTargetCountUnder24}`);
  for (const r of rules) {
    console.log(`    ${r.id} (${r.count}) ${r.impact}: ${r.help}`);
    for (const s of (r.sample || [])) console.log(`      sel: ${String(s.target).slice(0, 120)}\n      fix: ${String(s.summary).replace(/\n/g, ' | ').slice(0, 260)}`);
  }
}
