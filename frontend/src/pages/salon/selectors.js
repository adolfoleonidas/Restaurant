/**
 * Pure derivations for the Salón screen: floor states, tallies, the card units
 * of the floor, and the model of the table sheet. No React, no I/O: the screen
 * and its tests share exactly the same rules.
 */
import { fmtMoney, fmtElapsed, elapsedMinutes, countOf } from '@/lib/format';
import { activeAttentionOrder, canCloseAttention } from '@/lib/attentionClose';
import { partitionPriorPickupOrders } from '@/lib/serviceDay';
import {
    draftCount, isDraft, personLabel, sendAction, tableSummary, itemsTotal,
} from '@/lib/orderDraft';
import {
    groupAccountTables,
    groupLabel,
    groupMembers,
} from '@/lib/tableGroups';

export const LEGEND = ['libre', 'sentados', 'preparando', 'listo', 'cuenta', 'pagada', 'atencion', 'reservada'];

export const STATE_FILTERS = [
    { key: 'todas', label: 'Todas' },
    { key: 'libre', label: 'Libres' },
    { key: 'activas', label: 'Ocupadas' },
    { key: 'listo', label: 'Por entregar' },
    { key: 'cuenta', label: 'Por cobrar' },
];

// Estados del piso que cuenta cada filtro (para los conteos de los filtros).
export const STATE_FILTER_FLOORS = {
    libre: ['libre'],
    activas: ['sentados', 'preparando', 'entregado', 'atencion'],
    listo: ['listo'],
    cuenta: ['cuenta'],
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

/** Un ítem sigue "en cocina" mientras no esté entregado ni anulado. */
export const itemPending = (it) => !['entregado', 'cancelado'].includes(it.status || 'pendiente');

/**
 * Estados agregados de los platos de una cuenta, en el orden en que reclaman
 * acción: lo listo se sirve antes de enviar nada nuevo, y lo que ya salió no
 * cuenta para ninguna acción.
 */
export function accountTally(order) {
    const items = (order?.items || []).filter((it) => it.status !== 'cancelado');
    return {
        ready: itemQty(items, (it) => it.status === 'listo'),
        drafts: itemQty(items, itemPending),
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

// ── Orders ───────────────────────────────────────────────────────────────

/** Last live order per table id. */
export function indexOrdersByTable(orders) {
    const map = {};
    for (const o of orders) if (o.table_id) map[o.table_id] = o;
    return map;
}

const CLOSED_STATUSES = ['cancelado', 'pagado'];

/** Una cuenta debe algo cuando está abierta y ya tiene algo más que borradores. */
const orderDue = (o) => {
    if (!o || CLOSED_STATUSES.includes(o.status) || isComposingDraft(o)) return 0;
    return Math.max(0, Number(o.total || 0) - Number(o.amount_paid || 0));
};

/**
 * Header counters (former Servicio header). Los borradores todavía no viajaron
 * a cocina ni se cobran: no cuentan como "en cocina" ni como "por cobrar".
 * `toPrep` y `toReady` son platos; `toPay` son cuentas (el Salón lo reemplaza
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
        if (orderDue(o) > 0) toPay += 1;
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
            ? visitOrders.reduce((sum, o) => sum + orderDue(o), 0)
            : (serviceOrder && serviceOrder.status !== 'cancelado'
                ? Math.max(0, Number(serviceOrder.total || 0) - Number(serviceOrder.amount_paid || 0))
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
        };
    });
    return [
        ...singles.map((entry) => ({ type: 'single', entry, floor: entry.floor, anchorNumber: Number(entry.table.number) })),
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

export function filterUnits(units, { areaFilter, stateFilter, search }) {
    const list = units.filter((unit) => {
        const entries = unit.type === 'group' ? unit.members : [unit.entry];
        if (areaFilter !== 'todas' && !entries.some((e) => e.table.area === areaFilter)) return false;
        const key = unit.floor.key;
        if (stateFilter === 'libre' && key !== 'libre') return false;
        if (stateFilter === 'activas' && !['sentados', 'preparando', 'entregado', 'atencion'].includes(key)) return false;
        if (stateFilter === 'listo' && key !== 'listo') return false;
        if (stateFilter === 'cuenta' && key !== 'cuenta') return false;
        if (search && !entries.some((e) => `${e.table.number} ${e.table.name}`.toLowerCase().includes(search.toLowerCase()))) return false;
        return true;
    });
    // Fixed order by anchor number: the floor must not reshuffle on every
    // state change (it disorients the waiter mid-service). Urgency is shown
    // by colour, the state filters and the summary bar instead.
    return list.slice().sort((a, b) => a.anchorNumber - b.anchorNumber);
}

/** Free tables that can receive one account of the open table. */
export function freeTablesForAccountMove(tables, openTableId) {
    return (tables || []).filter((t) => (
        t.status === 'disponible' && !t.active_order && !t.active_attention_id && t.id !== openTableId
    ));
}

// ── Table sheet ──────────────────────────────────────────────────────────

/**
 * Everything the table sheet renders, derived from the open table, the live
 * order and the floor. `activeOrders` is keyed by TABLE id, so the lookups by
 * account id below fall back to the account itself (kept as is).
 */
export function selectSheetModel({
    openTable, sheetOrder, tables, activeOrders, canTake, canClose,
}) {
    const { table: openedTable, history, loading, accountTable, accounts, accountId } = openTable;
    // El estado sale de la mesa viva del piso, no de la copia que se guardó al abrir la hoja.
    const t = (tables || []).find((candidate) => candidate.id === openedTable.id) || openedTable;
    const group = openTable.group || t.group || null;
    const members = group ? groupMembers(group, tables) : [];
    const groupAccounts = group ? groupAccountTables(group, tables, activeOrders) : [];
    const order = sheetOrder;
    const currentAccountId = order?.id || accountId || t.active_order?.id || null;
    const floor = floorState(t);
    // Composición inline: se puede pedir mientras la mesa no esté cerrada.
    const canCompose = canTake && ['disponible', 'ocupada'].includes(t.status);
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
            shared: Boolean(detail.shared),
            draftCount: draftCount(detail.items || [], detail.status),
        };
    });
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
    // Lo que falta enviar de la cuenta que se está armando.
    const pendingCount = order ? draftCount(order.items || [], order.status) : 0;
    // Con la pantalla limpia para la siguiente persona, las acciones
    // de la mesa siguen apuntando a una cuenta real.
    const fallbackPerson = persons[0] || null;
    const actionOrder = order
        || (fallbackPerson ? (activeOrders[fallbackPerson.id] || allAccounts.find((o) => o.id === fallbackPerson.id)) : null);
    const actionAccountId = currentAccountId || fallbackPerson?.id || null;
    // Con la pantalla limpia para la siguiente persona, las acciones
    // de la mesa (entregar, cobrar, finalizar) siguen funcionando.
    const closeable = canClose && canCloseAttention(t, actionOrder);
    const billRequested = Boolean(actionOrder?.payment_requested) || actionOrder?.status === 'pendiente_pago';
    return {
        table: t,
        history,
        loading,
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
        showSend,
        allAccounts,
        hasAccount,
        personAccounts,
        persons,
        summaryRows,
        receiptAccounts,
        tableDishes,
        tableTotal,
        pendingCount,
        actionOrder,
        actionAccountId,
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
    return Boolean(miniOrder) && !openTable && !showNewOrder && !transferSource
        && !moveAccountId && !selectMode;
}
