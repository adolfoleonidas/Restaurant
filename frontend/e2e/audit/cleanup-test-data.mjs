// Limpieza dirigida de datos de prueba: elimina las mesas E2E (número >= 90000)
// que no tienen pedidos y limpia la descripción pública de prueba
// ("Carta E2E <timestamp>"). Por defecto es un simulacro: pasa --apply para
// ejecutar.
//
//   node e2e/audit/cleanup-test-data.mjs            # simulacro
//   node e2e/audit/cleanup-test-data.mjs --apply    # aplica

const BASE = process.env.AUDIT_API || 'http://127.0.0.1:8000/api';
const APPLY = process.argv.includes('--apply');
const MIN_E2E = 90000;

const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@resto.com', password: 'admin123' }),
});
if (!login.ok) throw new Error(`login ${login.status}`);
const { access_token: token } = await login.json();
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const get = async (p) => (await fetch(`${BASE}${p}`, { headers })).json();
const req = async (method, p, body) => {
  const r = await fetch(`${BASE}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ok: r.ok, status: r.status, text: await r.text() };
};

const [tables, orders, restaurant] = await Promise.all([get('/tables'), get('/orders'), get('/restaurants/current')]);
const e2e = (tables || []).filter((t) => Number(t.number) >= MIN_E2E);
const orderTableIds = new Set((orders || []).map((o) => o.table_id).filter(Boolean));
const deletable = e2e.filter((t) => !orderTableIds.has(t.id));
const keep = e2e.filter((t) => orderTableIds.has(t.id));

const desc = restaurant?.public_description || '';
const descIsTest = /^Carta\s*E2E/i.test(desc);

console.log(`Mesas totales: ${tables.length}`);
console.log(`Mesas E2E (>= ${MIN_E2E}): ${e2e.length}`);
console.log(`  con pedidos activos (se conservan): ${keep.length}`);
console.log(`  sin pedidos (se eliminan): ${deletable.length}`);
console.log(`Descripción pública actual: "${desc}"${descIsTest ? '  <- texto de prueba' : ''}`);
console.log(`Modo: ${APPLY ? 'APLICA' : 'SIMULACRO'}`);

if (APPLY) {
  const results = { deleted: 0, failed: [], descriptionCleared: false };
  for (const t of deletable) {
    const r = await req('DELETE', `/tables/${t.id}`);
    if (r.ok) results.deleted += 1;
    else results.failed.push({ number: t.number, status: r.status, detail: r.text.slice(0, 120) });
    if (results.deleted % 25 === 0) console.log(`  eliminadas: ${results.deleted}...`);
  }
  if (descIsTest) {
    const r = await req('PATCH', '/restaurants/current', { public_description: '' });
    results.descriptionCleared = r.ok;
    if (!r.ok) console.log(`  no se pudo limpiar la descripción: ${r.status} ${r.text.slice(0, 120)}`);
  }
  const after = await get('/tables');
  console.log(`\nResultado: eliminadas ${results.deleted}/${deletable.length} mesas; fallos: ${results.failed.length}`);
  if (results.failed.length) console.log('Primeros fallos:', JSON.stringify(results.failed.slice(0, 3)));
  console.log(`Descripción pública ahora: "${((await get('/restaurants/current')).public_description) || ''}"`);
  console.log(`Mesas totales después: ${after.length}`);
} else {
  console.log(`\nSimulacro: se eliminarían ${deletable.length} mesas y se${descIsTest ? ' limpiaría' : ' dejaría'} la descripción pública. Vuelve a ejecutar con --apply.`);
}
