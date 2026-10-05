// Crea una cuenta pendiente de cobro (una mesa + un pedido con la cuenta
// solicitada) para poder verificar en vivo el diálogo de cobro, que hasta ahora
// solo se podía revisar leyendo el código: la pasada de interacción siempre la
// saltaba porque no había ninguna cuenta por cobrar.
//
//   node e2e/audit/fixture-bill.mjs
//
// Señaliza el pedido con `payment_requested`, que es el estado que Caja usa para
// mostrarlo en "Cuentas solicitadas" (pages/Caja.jsx:620).

const BASE = process.env.AUDIT_API || 'http://127.0.0.1:8000/api';

const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'mozo.test@example.com', password: 'test1234' }),
});
if (!login.ok) throw new Error(`login mozo ${login.status}`);
const { access_token: token } = await login.json();
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const req = async (method, p, body) => {
  const r = await fetch(`${BASE}${p}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { ok: r.ok, status: r.status, json: (() => { try { return JSON.parse(text); } catch { return text; } })() };
};

// 1. producto disponible
const products = (await req('GET', '/products')).json;
const list = Array.isArray(products) ? products : (products?.items || products?.data || []);
const product = list.find((p) => p.is_available !== false) || list[0];
if (!product) throw new Error('sin productos disponibles');
console.log(`producto: ${product.name} (${product.id})`);

// 2. mesa libre
const tables = (await req('GET', '/tables')).json;
const tlist = Array.isArray(tables) ? tables : [];
const free = tlist.find((t) => !t.is_occupied && Number(t.number) < 90000);
if (!free) throw new Error('sin mesa libre');
console.log(`mesa: ${free.number} (${free.id})`);

// 3. pedido con la cuenta solicitada
const created = await req('POST', '/orders', {
  table_id: free.id,
  items: [{ product_id: product.id, quantity: 1 }],
  payment_requested: true,
});
if (!created.ok) {
  // Algunas versiones no aceptan payment_requested en el alta: se pide después.
  console.log(`alta sin payment_requested (${created.status}), intentando otra forma...`);
}
const orderId = created.json?.id;
if (!orderId) {
  const list2 = (await req('GET', '/orders')).json;
  const arr = Array.isArray(list2) ? list2 : [];
  const hit = arr.find((o) => o.table_id === free.id);
  if (!hit) throw new Error(`no se pudo crear el pedido: ${JSON.stringify(created.json).slice(0, 200)}`);
  console.log(`pedido existente en la mesa: ${hit.id} (#${hit.order_number}, estado=${hit.status})`);
}
const order = orderId || (await req('GET', '/orders')).json.find((o) => o.table_id === free.id)?.id;

// 4. se asegura de que la cuenta esté solicitada
if (order) {
  const cur = (await req('GET', `/orders/${order}`)).json;
  if (!cur.payment_requested && cur.status !== 'pendiente_pago') {
    const r = await req('POST', `/orders/${order}/status`, { status: 'pendiente_pago' });
    console.log(`status pendiente_pago: ${r.status} ${typeof r.json === 'string' ? r.json.slice(0, 120) : 'ok'}`);
  }
  const after = (await req('GET', `/orders/${order}`)).json;
  console.log(`\nResultado: pedido ${after.id} (#${after.order_number}) estado=${after.status} payment_requested=${after.payment_requested} total=${after.total}`);
  console.log('Ahora /caja debería mostrar la cuenta en "Cuentas solicitadas" y el botón "Cobrar" abriría el diálogo.');
} else {
  console.log('No se pudo identificar el pedido creado.');
}
