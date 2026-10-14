/**
 * Pure derivations for the Salón screen: floor states, tallies, the card units
 * of the floor, and the model of the table sheet. No React, no I/O: the screen
 * and its tests share exactly the same rules.
 */
import { fmtMoney, fmtElapsed, elapsedMinutes, countOf } from '@/lib/format';
import { FLOOR_STYLE } from '@/lib/floorStyle';
import { activeAttentionOrder, canCloseAttention } from '@/lib/attentionClose';
import { partitionPriorPickupOrders } from '@/lib/serviceDay';
import {
    draftCount, isDraft, orderStateTag, personLabel, sendAction, tableSummary, itemsTotal,
} from '@/lib/orderDraft';
import {
    groupAccountTables,
    groupLabel,
    groupMembers,
} from '@/lib/tableGroups';

/**
 * La leyenda y los filtros salen de `FLOOR_STYLE`: esa es la única lista de
 * estados del piso.
 *
 * Antes eran tres arrays escritos a mano y ya habían divergido: la leyenda no
 * mostraba «Entregado» ni «Inactiva», y tres estados (cuenta pagada, reservada,
 * inactiva) no se podían aislar con ningún filtro — al elegir cualquier filtro
 * desaparecían de la pantalla, sin atenuarse. `FloorStateCoverage.test.js` fija
 * que toda clave de `FLOOR_STYLE` esté en la leyenda y se pueda aislar.
 */
export const LEGEND = Object.keys(FLOOR_STYLE);

export const STATE_FILTERS = [
    { key: 'todas', label: 'Todas' },
    { key: 'libre', label: 'Libres' },
    { key: 'activas', label: 'En curso' },
    { key: 'listo', label: 'Por entregar' },
    { key: 'cuenta', label: 'Por cobrar' },
    { key: 'pagada', label: 'Por cerrar' },
    { key: 'reservada', label: 'Reservadas' },
    { key: 'anulada', label: 'Anuladas' },
    { key: 'inactiva', label: 'Inactivas' },
];

/**
 * Qué estados del piso entran en cada chip. Es el **único** sitio donde se
 * decide: `countByState` cuenta con este mapa y `filterUnits` filtra con él, así
 * que el número del chip no puede contradecir lo que aparece al pulsarlo.
 *
 * «En curso» agrupa las mesas que están en servicio y todavía no pidieron la
 * cuenta. Antes se llamaba «Ocupadas» y se tragaba también las anuladas, así que
 * una mesa con el pedido cancelado se contaba como ocupada; ahora cada estado
 * tiene su chip y ninguno queda fuera.
 */
export const STATE_FILTER_FLOORS = {
    libre: ['libre'],
    activas: ['sentados', 'preparando', 'entregado'],
    listo: ['listo'],
    cuenta: ['cuenta'],
    pagada: ['pagada'],
    reservada: ['reservada'],
    anulada: ['atencion'],
    inactiva: ['inactiva'],
};

/**
 * Padding inferior del contenido cuando la barra fija del pedido activo está
 * visible.
 *
 * `!` (important) es deliberado: el hueco normal de la barra de navegación lo
 * pone `.has-bottom-nav`, que vive en la capa `components` y le gana a
 * cualquier utilidad `pb-*` de la capa `utilities`. Con `md:!pb-0` se devuelve
 * el hueco al shell en escritorio, donde el mini va pegado al borde inferior.
 */
export const MINI_OPEN_CLASS = 'pb-44 md:!pb-0';

/**
 * Padding inferior del contenido mientras se eligen mesas para unir.
 *
 * La barra de "unir mesas" crece con lo que se elige (fichas, la línea de "para
 * qué es", la mesa principal y las dos acciones) y sus filas se envuelven en
 * pantallas estrechas, así que el hueco es el de la barra **más alta** y no el
 * de la más común: si se queda corto, la última fila de mesas vive debajo de la
 * barra y el mozo no puede tocar lo que no ve. `!` por el mismo motivo que en
 * `MINI_OPEN_CLASS`.
 */
export const SELECT_OPEN_CLASS = 'pb-56 md:!pb-44';

// ── Floor order ──────────────────────────────────────────────────────────

/**
 * Orden del piso: "Número" es el de siempre (fijo por mesa de ancla, el piso no
 * se rebaraja solo) y "Prioridad" es el del prototipo (lo que reclama acción
 * primero). La preferencia se recuerda por usuario en localStorage, la misma
 * convención que el alcance de sucursal: la elección de un dispositivo no
 * cambia la del otro y el navegador puede negarse (modo privado).
 */
const SORT_STORAGE_PREFIX = 'salon-orden';
export const SORT_NUMERO = 'numero';
export const SORT_PRIORIDAD = 'prioridad';

function sortStorageKey(userId) {
    return `${SORT_STORAGE_PREFIX}:${userId || 'anon'}`;
}

export function readSortMode(userId) {
    try {
        return window.localStorage.getItem(sortStorageKey(userId)) === SORT_PRIORIDAD
            ? SORT_PRIORIDAD
            : SORT_NUMERO;
    } catch {
        return SORT_NUMERO;
    }
}

export function rememberSortMode(userId, mode) {
    try {
        window.localStorage.setItem(sortStorageKey(userId), mode);
    } catch {
        /* sin memoria: el orden vale solo para esta sesión */
    }
}

// Puntaje de prioridad del prototipo: el estado pesa más que la espera.
// "Ocupada" agrupa los estados intermedios de una visita en curso.
const FLOOR_PRIORITY = {
    listo: 5000,
    cuenta: 4000,
    sentados: 3000,
    preparando: 3000,
    entregado: 3000,
    atencion: 3000,
    reservada: 1000,
};

export function priorityScore(unit) {
    return (FLOOR_PRIORITY[unit.floor.key] || 0) + elapsedMinutes(unit.createdAt);
}

/** Zona de una unidad: la del ancla; con filtro activo, la del miembro que coincide. */
export function unitZone(unit, activeArea) {
    const entries = unit.type === 'group' ? unit.members : [unit.entry];
    if (activeArea !== 'todas') {
        const hit = entries.find((e) => e.table.area === activeArea);
        if (hit) return hit.table.area;
    }
    const anchor = unit.type === 'group' ? unit.anchor : unit.entry;
    return anchor.table.area || 'Sin zona';
}

// ── Floor states ─────────────────────────────────────────────────────────

export function floorState(t) {
    const o = t.active_order;
    if (t.status === 'inactiva') return { key: 'inactiva' };
    if (t.status === 'reservada' && !o) return { key: 'reservada' };
    if (o?.status === 'cancelado') return { key: 'atencion' };
    if (o?.status === 'pagado' || (t.status === 'pagada' && !o)) return { key: 'pagada' };
    if (t.status === 'disponible' && !o) return { key: 'libre' };
    if (o?.status === 'pendiente_pago' || t.status === 'esperando_pago') return { key: 'cuenta' };
    if (o?.status === 'listo') return { key: 'listo' };
    if (o?.status === 'entregado') return { key: 'entregado' };
    if (o && ['enviado_cocina', 'en_preparacion', 'nuevo'].includes(o.status)) return { key: 'preparando' };
    if (t.status === 'ocupada' && !o) return { key: 'sentados' };
    return { key: 'sentados' };
}

// Urgencia relativa de cada estado: al unir mesas, el grupo hereda el estado
// más urgente (cuenta > listo > atención > preparando > …). Menor = más urgente.
const FLOOR_RANK = {
    cuenta: 0,
    listo: 1,
    atencion: 2,
    preparando: 3,
    entregado: 4,
    sentados: 5,
    reservada: 6,
    pagada: 7,
    libre: 8,
    inactiva: 9,
};

export function groupFloorState(members) {
    return members.reduce((best, m) => (
        (FLOOR_RANK[m.floor.key] ?? 9) < (FLOOR_RANK[best.floor.key] ?? 9) ? m : best
    )).floor;
}

export function itemQty(items, predicate) {
    return (items || []).filter(predicate).reduce((s, it) => s + (it.quantity || 0), 0);
}

/**
 * Saldo de una cuenta: la misma fuente que la tarjeta muestra como "Debe S/ X"
 * (total menos lo ya pagado), sin volver a sumar los platos. La usan el piso,
 * el resumen de la hoja y el botón de cobro para que digan siempre lo mismo.
 */
export function accountDue(order) {
    return Math.max(0, Number(order?.total || 0) - Number(order?.amount_paid || 0));
}

/**
 * Estado agregado de una cuenta para el tag de su tarjeta en el detalle
 * (S12: el estado es POR PEDIDO, no por ítem). Delega en `orderStateTag` para
 * que la tarjeta y el bloque enviado del ticket compartan exactamente la misma
 * regla; los tonos viven en `KITCHEN_TONE` (OrderSummary).
 */
export function accountKitchenState(items = [], orderStatus) {
    return orderStateTag(items, orderStatus);
}

/**
 * Estados agregados de los platos de una cuenta, en el orden en que reclaman
 * acción: lo listo se sirve antes de enviar nada nuevo, y lo que ya salió no
 * cuenta para ninguna acción.
 */
export function accountTally(order) {
    const items = (order?.items || []).filter((it) => it.status !== 'cancelado');
    return {
        ready: itemQty(items, (it) => it.status === 'listo'),
        // S14: "por enviar" son solo los borradores reales. Antes contaba también
        // lo ya enviado y el mini ofrecía "Enviar" sin nada que enviar.
        drafts: itemQty(items, (it) => isDraft(it, order?.status)),
        kitchen: itemQty(items, (it) => ['pendiente', 'enviado_cocina', 'en_preparacion'].includes(it.status)),
        served: itemQty(items, (it) => it.status === 'entregado'),
    };
}

/** Texto corto del estado agregado ("Listo para entregar · 2"). */
export function tallyLabel(tally) {
    if (tally.ready > 0) return `Listo para entregar · ${tally.ready}`;
    if (tally.drafts > 0) return `Por enviar · ${tally.drafts}`;
    if (tally.kitchen > 0) return `En cocina · ${tally.kitchen}`;
    if (tally.served > 0) return `Entregado · ${tally.served}`;
    return 'Sin platos todavía';
}

/**
 * Una cuenta sigue siendo el pedido a medio armar mientras nada haya salido a
 * cocina: sus productos están en borrador. Recién al enviarla se convierte en
 * una persona de la mesa, sin que el mozo "abra" nada.
 *
 * El alias no cuenta: se puede escribir (y guardar) antes de enviar, y eso no
 * convierte el borrador en una persona.
 */
export function isComposingDraft(order) {
    if (!order) return false;
    return !(order.items || []).some((item) => !isDraft(item, order.status));
}

export const isComposableTable = (table) => ['disponible', 'ocupada'].includes(table?.status);

export function canComposeAccountAt(account, table, attentionId = table?.active_attention_id) {
    return Boolean(account?.id && isComposableTable(table)
        && account.table_id === table.id
        && (!account.order_type || account.order_type === 'mesa')
        && !['pagado', 'cancelado'].includes(account.status)
        && (!account.attention_state || account.attention_state === 'open')
        && (!attentionId || account.attention_id === attentionId)
        && (!account.branch_id || !table.branch_id || account.branch_id === table.branch_id));
}

// Keep local account cards current without adding a followed group's bill to this table.
export function accountSnapshots(sheet, account) {
    const accounts = sheet.accounts || [];
    if (!account?.id) return accounts;
    if (accounts.some((entry) => entry.id === account.id)) {
        return accounts.map((entry) => (entry.id === account.id ? account : entry));
    }
    return account.table_id === sheet.table.id ? [...accounts, account] : accounts;
}

// ── Orders ───────────────────────────────────────────────────────────────

/** Last live order per table id. */
export function indexOrdersByTable(orders) {
    const map = {};
    for (const o of orders) if (o.table_id) map[o.table_id] = o;
    return map;
}

const CLOSED_STATUSES = ['cancelado', 'pagado'];

/** Una cuenta debe algo cuando está abierta y ya tiene algo más que borradores. */
const billableDue = (order) => (
    !order || CLOSED_STATUSES.includes(order.status) || isComposingDraft(order) ? 0 : accountDue(order)
);

/**
 * Header counters (former Servicio header). Los borradores todavía no viajaron
 * a cocina ni se cobran: no cuentan como "en cocina" ni como "por cobrar".
 * `toPrep` y `toReady` son platos; `toPay` son cuentas (el piso lo reemplaza
 * por las mesas del filtro "Por cobrar" para que cabecera y chips coincidan).
 */
export function summarizeOrders(orders) {
    let toPrep = 0;
    let toReady = 0;
    let toPay = 0;
    for (const o of orders) {
        const items = o.items || [];
        toPrep += itemQty(items, (it) => !isDraft(it, o.status)
            && !['entregado', 'cancelado', 'listo'].includes(it.status || 'pendiente'));
        toReady += itemQty(items, (it) => it.status === 'listo');
        if (billableDue(o) > 0) toPay += 1;
    }
    return { toPrep, toReady, toPay };
}

// Región viva para lectores de pantalla: el salón se actualiza por polling y
// los cambios de estado llegan sin aviso (4.1.3). El texto solo cambia si
// cambian los conteos, así que no se repite en cada refresco.
export const floorSummaryText = (summary) => (
    `En cocina ${countOf(summary.toPrep, 'plato', 'platos')} · listos ${countOf(summary.toReady, 'plato', 'platos')} · por cobrar ${countOf(summary.toPay, 'mesa', 'mesas')}`
);

export function projectPickups(orders) {
    const { live, prior } = partitionPriorPickupOrders(orders);
    const active = live.filter((o) => (
        o.order_type === 'recojo'
        && !o.table_id
        && !['entregado', 'pagado', 'cancelado'].includes(o.status)
    ));
    return { active, prior };
}

// ── Floor ────────────────────────────────────────────────────────────────

export function listAreas(tables) {
    // `t.area` puede venir vacío (mesas antiguas sin zona). Sin filtrar, la
    // fila de zonas pintaba un chip "undefined" y React avisaba de una clave
    // ausente en la lista (`key={undefined}` no cuenta como clave).
    const s = new Set((tables || []).map((t) => t.area).filter(Boolean));
    return ['todas', ...Array.from(s)];
}

export function decorateTables({
    tables, byTable, orders, activeOrders,
}) {
    return (tables || []).map((t) => {
        const floor = floorState(t);
        const listOrder = byTable[t.id] || null;
        const attentionOrder = activeAttentionOrder(t, orders);
        const displayOrder = t.active_order || attentionOrder || listOrder || null;
        const serviceOrder = t.active_attention_id ? attentionOrder : (listOrder || t.active_order || null);
        const items = serviceOrder?.items || [];
        const ready = itemQty(items, (it) => it.status === 'listo');
        const pendingPrep = itemQty(items, (it) => !['entregado', 'cancelado', 'listo'].includes(it.status || 'pendiente'));
        // Una visita puede tener varias cuentas: la tarjeta debe lo que deben todas.
        const visitOrders = t.active_attention_id
            ? (orders || []).filter((o) => (
                o.table_id === t.id
                && o.attention_id === t.active_attention_id
                && ['open', 'closing'].includes(o.attention_state)
            ))
            : [];
        const due = visitOrders.length > 0
            ? visitOrders.reduce((sum, o) => sum + billableDue(o), 0)
            : (serviceOrder && serviceOrder.status !== 'cancelado'
                ? accountDue(serviceOrder)
                : 0);
        const billRequested = Boolean(serviceOrder?.payment_requested) || serviceOrder?.status === 'pendiente_pago';
        const showVisitaActiva = Boolean(t.active_attention_id) && !attentionOrder && Boolean(listOrder);
        const group = t.group || null;
        // A joined group reports how many bills it holds: with two, the
        // card must not pretend there is a single account.
        const groupBadge = group
            ? {
                label: groupLabel(group, tables),
                accounts: groupAccountTables(group, tables, activeOrders).length,
            }
            : null;
        const groupNumbers = group ? groupMembers(group, tables).map((m) => m.number) : null;
        return {
            table: t, floor, displayOrder, serviceOrder, ready, pendingPrep, due, billRequested,
            showVisitaActiva, group, groupBadge, groupNumbers,
            // Las cuentas vivas de la misma visita. El cierre las exige liquidadas
            // (`attention.py:444-451`), así que la tarjeta tiene que verlas para no
            // ofrecer «Finalizar mesa» cuando el servidor lo va a rechazar.
            visitOrders,
        };
    });
}

// Unidades del piso: una mesa individual = una tarjeta; un grupo = UNA
// tarjeta grande con mesa principal + mini-mesas (igual que el prototipo).
export function buildUnits({ decorated, tables, activeOrders }) {
    const byGroup = new Map();
    const singles = [];
    for (const entry of decorated) {
        const gid = entry.group?.id;
        if (gid) {
            if (!byGroup.has(gid)) byGroup.set(gid, []);
            byGroup.get(gid).push(entry);
        } else {
            singles.push(entry);
        }
    }
    const groupUnits = [...byGroup.values()].map((members) => {
        members.sort((a, b) => Number(a.table.number) - Number(b.table.number));
        const group = members[0].group;
        const anchor = members.find((m) => m.table.id === group.anchor_table_id) || members[0];
        const floor = groupFloorState(members);
        const numbers = members.map((m) => Number(m.table.number));
        const accounts = groupAccountTables(group, tables, activeOrders).length;
        const dueSum = members.reduce((s, m) => s + (m.due || 0), 0);
        const totalSum = members.reduce((s, m) => s + (Number(m.serviceOrder?.total) || Number(m.displayOrder?.total) || 0), 0);
        const amount = dueSum > 0 ? `Debe ${fmtMoney(dueSum)}` : (totalSum > 0 ? fmtMoney(totalSum) : null);
        const maxCreated = members.reduce((acc, m) => {
            const iso = m.displayOrder?.created_at || m.serviceOrder?.created_at || null;
            if (!iso) return acc;
            return (!acc || new Date(iso) > new Date(acc)) ? iso : acc;
        }, null);
        const minutes = elapsedMinutes(maxCreated);
        const urgency = minutes >= 45 ? 'bad' : minutes >= 30 ? 'warn' : null;
        return {
            type: 'group', group, members, anchor, floor, numbers, accounts, amount,
            elapsed: maxCreated ? fmtElapsed(maxCreated) : null, minutes, urgency,
            isLate: floor.key === 'cuenta' && urgency === 'bad',
            anchorNumber: Number(anchor.table.number),
            createdAt: maxCreated,
        };
    });
    return [
        ...singles.map((entry) => ({
            type: 'single', entry, floor: entry.floor, anchorNumber: Number(entry.table.number),
            createdAt: entry.displayOrder?.created_at || entry.serviceOrder?.created_at || null,
        })),
        ...groupUnits,
    ];
}

// Conteos por estado para los filtros: cuentan tarjetas (una por unidad),
// de modo que "Todas" refleja lo que se ve en pantalla.
export function countByState(units) {
    const counts = { todas: units.length };
    for (const f of STATE_FILTERS) {
        if (f.key === 'todas') continue;
        const floors = STATE_FILTER_FLOORS[f.key] || [];
        counts[f.key] = units.filter((u) => floors.includes(u.floor.key)).length;
    }
    return counts;
}

export function filterUnits(units, {
    areaFilter, stateFilter, search, sortMode,
}) {
    const list = units.filter((unit) => {
        const entries = unit.type === 'group' ? unit.members : [unit.entry];
        if (areaFilter !== 'todas' && !entries.some((e) => e.table.area === areaFilter)) return false;
        // El mismo mapa que cuenta los chips decide qué entra en cada uno: la
        // lista estaba escrita otra vez aquí y ya habían divergido.
        const floors = STATE_FILTER_FLOORS[stateFilter];
        if (floors && !floors.includes(unit.floor.key)) return false;
        if (search && !entries.some((e) => `${e.table.number} ${e.table.name}`.toLowerCase().includes(search.toLowerCase()))) return false;
        return true;
    });
    // Fixed order by anchor number keeps the floor stable on every state
    // change (it disorients the waiter mid-service). Priority is an explicit
    // choice: it puts what claims action first and breaks ties by anchor
    // number, so two cards with the same state still have a stable order.
    return list.slice().sort(sortMode === SORT_PRIORIDAD
        ? (a, b) => (priorityScore(b) - priorityScore(a)) || (a.anchorNumber - b.anchorNumber)
        : (a, b) => a.anchorNumber - b.anchorNumber);
}

// Consumo del piso: saldos pendientes de todas las unidades (el grupo suma
// las cuentas de sus mesas). No depende de los filtros: es el total del
// salón, como el "S/ X en mesas" del prototipo.
export function sumFloorDue(units) {
    return units.reduce((sum, unit) => (
        sum + (unit.type === 'group'
            ? unit.members.reduce((s, m) => s + (m.due || 0), 0)
            : (unit.entry.due || 0))
    ), 0);
}

// Piso por zonas: una sección por zona con mesas visibles, en el orden en
// que la zona aparece en el piso. Sin mesas, la sección no existe.
export function buildZoneSections(filteredUnits, areas, areaFilter) {
    const buckets = new Map();
    for (const unit of filteredUnits) {
        const area = unitZone(unit, areaFilter);
        if (!buckets.has(area)) buckets.set(area, []);
        buckets.get(area).push(unit);
    }
    const known = areas.filter((a) => a !== 'todas' && buckets.has(a));
    const extra = [...buckets.keys()].filter((a) => !known.includes(a));
    return [...known, ...extra].map((area) => ({ area, units: buckets.get(area) }));
}

/** Free tables that can receive one account of the open table. */
export function freeTablesForAccountMove(tables, openTableId) {
    return (tables || []).filter((t) => (
        t.status === 'disponible' && !t.active_order && !t.active_attention_id && t.id !== openTableId
    ));
}

// ── Table sheet ──────────────────────────────────────────────────────────

/**
 * La hoja muestra el snapshot más fresco: el polling vivo puede ser anterior
 * a una recarga puntual (alta de producto, alias), y con la versión vieja la
 * línea recién agregada no aparecía hasta el próximo refresco.
 */
export function selectFreshOrder(openOrder, liveOrder) {
    const open = openOrder || null;
    if (!open) return null;
    if (!liveOrder || liveOrder.id !== open.id) return open;
    return String(liveOrder.updated_at || '') >= String(open.updated_at || '')
        ? liveOrder
        : open;
}

/**
 * Everything the table sheet renders, derived from the open table, the live
 * order and the floor. `activeOrders` is keyed by TABLE id, so the lookups by
 * account id below fall back to the account itself (kept as is).
 */
export function selectSheetModel({
    openTable, sheetOrder, tables, activeOrders, orders, canTake, canClose,
}) {
    const { table: openedTable, history, loading, accountsLoading, accountTable, accounts, accountId } = openTable;
    // El estado sale de la mesa viva del piso, no de la copia que se guardó al abrir la hoja.
    const t = (tables || []).find((candidate) => candidate.id === openedTable.id) || openedTable;
    const group = openTable.group || t.group || null;
    const members = group ? groupMembers(group, tables) : [];
    const groupAccounts = group ? groupAccountTables(group, tables, activeOrders) : [];
    const order = sheetOrder;
    const currentAccountId = order?.id || accountId || t.active_order?.id || null;
    const floor = floorState(t);
    // Composición inline: se puede pedir mientras la mesa no esté cerrada.
    const composeTable = (tables || []).find((entry) => entry.id === t.id) || t;
    const canCompose = canTake && isComposableTable(composeTable);
    const allItems = order?.items || [];
    const orderItems = allItems.filter((i) => i.status !== 'cancelado');
    // Qué ofrece el botón de envío: la comanda entera la primera
    // vez, y después sólo los adicionales.
    const sendState = order ? sendAction(allItems, order) : null;
    const showSend = Boolean(sendState)
        && (sendState.kind === 'extra' ? sendState.count > 0 : allItems.length > 0);
    // Cada cuenta es una persona, pero sólo se muestra como tal
    // cuando algo salió a cocina: mientras todo es borrador, es el
    // "nuevo pedido" que el mozo todavía está armando.
    const allAccounts = accounts || [];
    // La visita la crea el primer pedido, no un botón: por eso la
    // barra depende de que exista una cuenta —incluida la que se
    // acaba de crear— y no del pedido que el listado del piso
    // todavía no refrescó.
    const hasAccount = Boolean(t.active_order || order || allAccounts.length > 0);
    const personAccounts = allAccounts.filter((o) => !isComposingDraft(activeOrders[o.id] || o));
    const persons = personAccounts.map((o, index) => {
        const detail = activeOrders[o.id] || o;
        return {
            id: o.id,
            number: o.order_number,
            label: personLabel(detail, index),
            // Alias real de la cuenta: el ✎ lo edita tal cual, sin
            // arrancar con el "Persona N" de relleno.
            alias: String(detail.customer_name || '').trim(),
            shared: Boolean(detail.shared),
            draftCount: draftCount(detail.items || [], detail.status),
        };
    });
    // Tarjetas del detalle: todas las cuentas, incluida la que
    // se está armando (un borrador todavía no es una persona).
    const cards = [...allAccounts];
    if (order && !cards.some((o) => o.id === order.id)) cards.push(order);
    const summaryRows = tableSummary(allAccounts.map((o, index) => {
        const detail = activeOrders[o.id] || o;
        return { id: o.id, label: personLabel(detail, index), items: detail.items || [] };
    }));
    const receiptAccounts = personAccounts.map((o, index) => {
        const detail = activeOrders[o.id] || o;
        return { id: o.id, label: personLabel(detail, index), total: itemsTotal(detail.items || []) };
    });
    // Salen de las mismas filas que se despliegan, así el número
    // de la barra nunca contradice el detalle.
    const tableDishes = summaryRows.reduce((sum, row) => sum + row.quantity, 0);
    const tableTotal = summaryRows.reduce((sum, row) => sum + row.subtotal, 0);
    // Consumido/Pagado/Pendiente de la mesa: del total y el pago
    // parcial de cada cuenta —la misma fuente del "Debe S/ X" de
    // la tarjeta—, sin volver a sumar platos.
    const tableConsumido = allAccounts.reduce((sum, o) => sum + Number((activeOrders[o.id] || o).total || 0), 0);
    const tablePagado = allAccounts.reduce((sum, o) => sum + Number((activeOrders[o.id] || o).amount_paid || 0), 0);
    const tablePendiente = allAccounts.reduce((sum, o) => sum + accountDue(activeOrders[o.id] || o), 0);
    // Lo que falta enviar de la cuenta que se está armando.
    const pendingCount = order ? draftCount(order.items || [], order.status) : 0;
    // Draft units enable clearing the active account's draft ticket.
    const draftUnits = orderItems
        .filter((it) => isDraft(it, order?.status))
        .reduce((sum, it) => sum + Number(it.quantity || 0), 0);
    // Con la pantalla limpia para la siguiente persona, las acciones
    // de la mesa siguen apuntando a una cuenta real.
    const fallbackPerson = persons[0] || null;
    const actionOrder = order
        || (fallbackPerson ? (activeOrders[fallbackPerson.id] || allAccounts.find((o) => o.id === fallbackPerson.id)) : null);
    const actionAccountId = currentAccountId || fallbackPerson?.id || null;
    // El botón de cobro cobra la cuenta que la hoja tiene activa:
    // el monto es su saldo, no el agregado de la mesa.
    const actionDue = accountDue(actionOrder);
    // Con la pantalla limpia para la siguiente persona, las acciones
    // de la mesa (entregar, cobrar, finalizar) siguen funcionando.
    // Con la pantalla limpia para la siguiente persona, las acciones
    // de la mesa (entregar, cobrar, finalizar) siguen funcionando.
    const visitSiblings = t.active_attention_id
        ? (orders || []).filter((o) => (
            o.id !== actionOrder?.id
            && o.table_id === t.id
            && o.attention_id === t.active_attention_id
            && ['open', 'closing'].includes(o.attention_state)
        ))
        : [];
    const closeable = canClose && canCloseAttention(t, actionOrder, visitSiblings);
    const billRequested = Boolean(actionOrder?.payment_requested) || actionOrder?.status === 'pendiente_pago';
    return {
        table: t,
        history,
        loading,
        // The table's account list is still on its way: what it must not allow is
        // starting an independent account before knowing whether one exists.
        accountsLoading: Boolean(accountsLoading),
        accountTable,
        accounts,
        group,
        members,
        groupAccounts,
        order,
        currentAccountId,
        floor,
        canCompose,
        allItems,
        orderItems,
        sendState,
        // La confirmación del envío que se muestra dentro de la hoja (ver `flashSent`).
        sentNotice: openTable.sentNotice || null,
        showSend,
        allAccounts,
        hasAccount,
        personAccounts,
        persons,
        cards,
        summaryRows,
        receiptAccounts,
        tableDishes,
        tableTotal,
        tableConsumido,
        tablePagado,
        tablePendiente,
        pendingCount,
        draftUnits,
        actionOrder,
        actionAccountId,
        actionDue,
        closeable,
        billRequested,
    };
}

// ── Mini player ──────────────────────────────────────────────────────────

// La cuenta puede haberse cerrado, cobrado o movido desde el último vistazo:
// el mini solo vive mientras el pedido siga abierto en la lista viva.
export function selectMiniOrder(orders, lastOpened) {
    if (!lastOpened) return null;
    const live = orders.find((o) => o.id === lastOpened.accountId && o.table_id === lastOpened.tableId);
    const order = live || lastOpened.account;
    if (!order || ['pagado', 'cancelado'].includes(order.status)) return null;
    return order;
}

export function isMiniVisible({
    miniOrder, openTable, showNewOrder, transferSource, moveAccountId, selectMode,
}) {
    if (!miniOrder) return false;
    if (openTable || showNewOrder || transferSource || moveAccountId || selectMode) return false;
    // Solo cuando hay ALGO QUE HACER con esa cuenta: productos sin enviar (trabajo a
    // medias que se perdería de vista) o platos listos para entregar. Si ya se envió
    // todo y nada está listo, la barra solo ocupaba el borde inferior —donde está el
    // pulgar y la barra de navegación— sin ofrecer nada.
    const tally = accountTally(miniOrder);
    return tally.drafts > 0 || tally.ready > 0;
}

/** The account under send review, from the freshest source that still holds it. */
export function selectReviewOrder({
    reviewOrderId, sheetOrder, openTable, miniOrder,
}) {
    if (!reviewOrderId) return null;
    return ((sheetOrder?.id === reviewOrderId ? sheetOrder : null)
        || (openTable?.order?.id === reviewOrderId ? openTable.order : null)
        || (miniOrder?.id === reviewOrderId ? miniOrder : null))
        || (openTable?.accounts || []).find((entry) => entry.id === reviewOrderId);
}
