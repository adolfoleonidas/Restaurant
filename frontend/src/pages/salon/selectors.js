/**
 * Pure derivations for the Salón screen: floor states, tallies, the card units
 * of the floor, and the model of the table sheet. No React, no I/O: the screen
 * and its tests share exactly the same rules.
 */
import { fmtMoney, fmtElapsed, elapsedMinutes } from '@/lib/format';
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

/** Texto corto del estado agregado ("Listo para servir · 2"). */
export function tallyLabel(tally) {
    if (tally.ready > 0) return `Listo para servir · ${tally.ready}`;
    if (tally.drafts > 0) return `Por enviar · ${tally.drafts}`;
    if (tally.kitchen > 0) return `En cocina · ${tally.kitchen}`;
    if (tally.served > 0) return `Servido · ${tally.served}`;
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

/** Header counters (former Servicio header). */
export function summarizeOrders(orders) {
    let toPrep = 0;
    let toReady = 0;
    let toPay = 0;
    for (const o of orders) {
        const items = o.items || [];
        toPrep += itemQty(items, (it) => !['entregado', 'cancelado', 'listo'].includes(it.status || 'pendiente'));
        toReady += itemQty(items, (it) => it.status === 'listo');
        const due = accountDue(o);
        if (due > 0) toPay += 1;
    }
    return { toPrep, toReady, toPay };
}

// Región viva para lectores de pantalla: el salón se actualiza por polling y
// los cambios de estado llegan sin aviso (4.1.3). El texto solo cambia si
// cambian los conteos, así que no se repite en cada refresco.
export const floorSummaryText = (summary) => (
    `En preparación ${summary.toPrep} · listos para entregar ${summary.toReady} · cuentas por cobrar ${summary.toPay}`
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
        const due = serviceOrder && serviceOrder.status !== 'cancelado'
            ? accountDue(serviceOrder)
            : 0;
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
        const key = unit.floor.key;
        if (stateFilter === 'libre' && key !== 'libre') return false;
        if (stateFilter === 'activas' && !['sentados', 'preparando', 'entregado', 'atencion'].includes(key)) return false;
        if (stateFilter === 'listo' && key !== 'listo') return false;
        if (stateFilter === 'cuenta' && key !== 'cuenta') return false;
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
    openTable, sheetOrder, tables, activeOrders, canTake, canClose,
}) {
    const { table: t, history, loading, accountTable, accounts, accountId } = openTable;
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
    return Boolean(miniOrder) && !openTable && !showNewOrder && !transferSource
        && !moveAccountId && !selectMode;
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
