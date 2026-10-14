/**
 * Reglas del pedido por persona (Mesa → Personas → Productos).
 *
 * Un producto vive en uno de tres estados visibles:
 *   borrador  → "Pendiente": todavía se corrige, no viajó a cocina.
 *   enviado   → "Enviado a cocina": cocina ya lo conoce.
 *   anulado   → "Anulado": se canceló después de enviarlo.
 *
 * Todo lo que sea agrupar, contar o etiquetar vive acá y no en el JSX, para que
 * la pantalla y los tests compartan exactamente la misma regla.
 */
import { fmtMoney } from './format';

export const DRAFT = 'borrador';
export const SHARED_ALIAS = 'Compartido';

const CANCELLED = 'cancelado';
const SENT = ['pendiente', 'en_preparacion', 'listo', 'entregado'];

export function isCancelled(item) {
    return (item?.status || '') === CANCELLED;
}

/**
 * Un producto es borrador si el backend lo marcó así. Los ítems viejos sin
 * estado sólo cuentan como borrador mientras la cuenta no salió a cocina.
 */
export function isDraft(item, orderStatus) {
    const status = item?.status || '';
    if (status === DRAFT) return true;
    if (status === CANCELLED || SENT.includes(status)) return false;
    return !orderStatus || orderStatus === 'nuevo';
}

export function isSent(item, orderStatus) {
    return !isDraft(item, orderStatus) && !isCancelled(item);
}

/** Los productos que se pueden tocar: sólo lo que todavía no salió a cocina. */
export function editableItems(items = [], orderStatus) {
    return items.filter((item) => isDraft(item, orderStatus));
}

export function draftCount(items = [], orderStatus) {
    return editableItems(items, orderStatus).length;
}

export function billableItems(items = []) {
    return items.filter((item) => !isCancelled(item));
}

export function itemsTotal(items = []) {
    return billableItems(items).reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
}

/**
 * Etiqueta del botón de envío. El mockup del tomador siempre dice
 * "Enviar a cocina · S/ X", tanto en el primer envío como en los adicionales;
 * el monto sale de `itemsTotal` (la cuenta entera en el primer envío, sólo el
 * borrador en los adicionales). `kind` y `count` se conservan para la lógica.
 */
export function sendAction(items = [], order = null) {
    const status = order?.status;
    const drafts = editableItems(items, status);
    if (!order || status === 'nuevo') {
        const amount = itemsTotal(items);
        return { kind: 'first', count: drafts.length, amount, label: `Enviar a cocina · ${fmtMoney(amount)}` };
    }
    if (drafts.length > 0) {
        const amount = itemsTotal(drafts);
        return { kind: 'extra', count: drafts.length, amount, label: `Enviar a cocina · ${fmtMoney(amount)}` };
    }
    return null;
}

export function personLabel(order, index = 0) {
    const alias = String(order?.customer_name || '').trim();
    // El número va SIEMPRE y sigue el orden de los pedidos: la primera persona de la
    // mesa es la 1 aunque le pongan nombre ("1. Alexis"), y sin nombre queda
    // "Persona 1". Así el mozo puede nombrar a quien quiera sin perder el orden.
    if (alias) return `${index + 1}. ${alias}`;
    if (order?.shared) return SHARED_ALIAS;
    return `Persona ${index + 1}`;
}

/** Estado visible de un producto, con su tono para pintarlo. */
export function itemState(item, orderStatus) {
    if (isCancelled(item)) return { key: 'anulado', label: 'Anulado', tone: 'void' };
    if (isDraft(item, orderStatus)) return { key: 'pendiente', label: 'Pendiente', tone: 'draft' };
    const status = item?.status || 'pendiente';
    if (status === 'listo') return { key: status, label: 'Listo', tone: 'ready' };
    if (status === 'entregado') return { key: status, label: 'Entregado', tone: 'done' };
    if (status === 'en_preparacion') return { key: status, label: 'En cocina', tone: 'kitchen' };
    return { key: 'enviado', label: 'Enviado a cocina', tone: 'kitchen' };
}

/**
 * Etiqueta de estado del PEDIDO, no de cada línea (S12: "deben ser por pedido y
 * no individual"). El tag vive una sola vez en la cabecera de la tarjeta/bloque
 * y las líneas van peladas, como el mockup.
 *
 * Regla: se mira sólo lo enviado, por etapa menos avanzada ("min stage"):
 *   - sin nada enviado (todo borrador)          → "Por enviar"
 *   - algún enviado que no está listo/entregado → "En cocina"
 *   - en otro caso, algún listo                 → "Listo"
 *   - todo lo enviado entregado                 → "Entregado"
 * Mixtos: "en cocina" manda sobre "listo" (todavía se está preparando algo);
 * "listo" manda sobre "entregado" (falta servir). El borrador no rebaja el tag:
 * lo enviado ya viajó a cocina y eso es lo que describe la etiqueta.
 */
export function orderStateTag(items = [], orderStatus) {
    const visible = (items || []).filter((it) => !isCancelled(it));
    if (!visible.length) return { key: 'empty', label: 'Sin platos' };
    const sent = visible.filter((it) => isSent(it, orderStatus));
    if (!sent.length) return { key: 'draft', label: 'Por enviar' };
    if (sent.some((it) => !['listo', 'entregado'].includes(it.status || ''))) {
        return { key: 'kitchen', label: 'En cocina' };
    }
    if (sent.some((it) => it.status === 'listo')) return { key: 'ready', label: 'Listo' };
    return { key: 'done', label: 'Entregado' };
}

function notesKey(notes) {
    return String(notes || '').trim().toLowerCase();
}

/**
 * Agrupación inteligente: productos exactamente iguales se suman en una línea
 * (4× Sopa) y cualquier observación distinta los separa (1× Pollo — Sin
 * ensalada). Internamente se conserva quién pidió cada uno.
 */
export function groupItems(entries = []) {
    const rows = new Map();
    for (const entry of entries) {
        const item = entry.item || entry;
        if (isCancelled(item)) continue;
        const name = item.product_name || 'Producto';
        // "Exactamente iguales" = mismo plato y misma observación. El nombre entra
        // en la clave para no fundir dos platos distintos que compartan código.
        const key = `${item.product_id || ''}::${name.trim().toLowerCase()}::${notesKey(item.notes)}`;
        const row = rows.get(key) || {
            key,
            product_id: item.product_id,
            product_name: name,
            unit_price: Number(item.unit_price ?? 0),
            quantity: 0,
            subtotal: 0,
            notes: String(item.notes || '').trim(),
            people: [],
            // Los ítems reales detrás de la línea: el resumen los despliega para
            // responder "¿quién pidió el pollo sin ensalada?" y para corregirlo.
            items: [],
        };
        const quantity = Number(item.quantity || 0);
        row.quantity += quantity;
        row.subtotal += Number(item.subtotal ?? quantity * (item.unit_price || 0));
        row.items.push({ item, person: entry.person || null, personId: entry.personId || null });
        if (entry.person) {
            const known = row.people.find((p) => p.label === entry.person);
            if (known) known.quantity += quantity;
            else row.people.push({ label: entry.person, quantity });
        }
        rows.set(key, row);
    }
    return [...rows.values()].sort((a, b) => (
        a.product_name.localeCompare(b.product_name) || a.notes.localeCompare(b.notes)
    ));
}

/** Resumen general de la mesa: todas las personas, agrupado. */
export function tableSummary(accounts = []) {
    const entries = [];
    for (const account of accounts) {
        const label = account.label;
        for (const item of account.items || []) {
            // Se guarda también de qué cuenta sale cada producto: mover una línea
            // necesita saber su origen, no sólo quién la pidió.
            entries.push({ item, person: label, personId: account.id || null });
        }
    }
    return groupItems(entries);
}

/** Resumen de una persona: sus productos, sin agrupar, para poder corregirlos. */
export function personItems(account) {
    return (account?.items || []).filter((item) => !isCancelled(item) || true);
}

/** Texto de una línea del resumen: "3× Pollo — Sin ensalada". */
export function summaryLine(row) {
    const notes = row.notes ? ` — ${row.notes}` : '';
    return `${row.quantity}× ${row.product_name}${notes}`;
}

/** "Juan, María" — quién pidió esta línea, para responder sin abrir cuentas. */
export function peopleLabel(row) {
    const people = row.people || [];
    if (!people.length) return '';
    if (people.length === 1) return people[0].label;
    return people.map((p) => p.label).join(', ');
}
