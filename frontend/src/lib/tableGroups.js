/**
 * Floor helpers for joined tables ("unir mesas") and for moving an open visit.
 *
 * A group is a marker, not an account: members that already ordered keep their
 * own bill, and a free member can open one. These helpers therefore talk about
 * the accounts of a group in the plural, and only read back a single account when
 * the group happens to hold exactly one.
 *
 * The API is the authority on every rule here: these helpers exist so the salón
 * only offers an action the backend would accept, and so both sides read the
 * same table state the same way.
 */
const ACTIVE_ATTENTION_STATES = ['opening', 'open', 'mutating', 'closing'];
const SETTLED_ORDER_STATUSES = ['pagado', 'cancelado'];
const JOINABLE_TABLE_STATUSES = ['disponible', 'ocupada'];
const TRANSFERABLE_TABLE_STATUSES = ['disponible', 'ocupada'];

/** True while an order still owns its table (unsettled, or its visit is open). */
export function orderOwnsTable(order) {
    if (!order) return false;
    if (!SETTLED_ORDER_STATUSES.includes(order.status)) return true;
    return ACTIVE_ATTENTION_STATES.includes(order.attention_state);
}

export function ordersByTable(orders = []) {
    const map = {};
    for (const order of orders || []) {
        if (order?.table_id && orderOwnsTable(order)) map[order.table_id] = order;
    }
    return map;
}

export function tableHasAccount(table, activeOrders = {}) {
    return Boolean(activeOrders?.[table?.id] || table?.active_order);
}

export function groupMembers(group, tables = []) {
    const ids = group?.table_ids || [];
    if (!ids.length) return [];
    const byId = new Map((tables || []).map((table) => [table.id, table]));
    return ids.map((id) => byId.get(id)).filter(Boolean).sort((a, b) => Number(a.number) - Number(b.number));
}

export function groupLabel(group, tables = []) {
    if (group?.name) return group.name;
    const members = groupMembers(group, tables);
    if (!members.length) return 'Mesas unidas';
    return `Mesas ${members.map((table) => table.number).join(' + ')}`;
}

/** The member the staff reads as the reference of the group. */
export function groupAnchor(group, tables = []) {
    const members = groupMembers(group, tables);
    if (!members.length) return null;
    return members.find((table) => table.id === group?.anchor_table_id) || members[0];
}

/** Every member that owns its own account: a group may hold several. */
export function groupAccountTables(group, tables = [], activeOrders = {}) {
    return groupMembers(group, tables).filter((table) => tableHasAccount(table, activeOrders));
}

/** The member that currently holds the account, falling back to the anchor. */
export function groupAccountTable(group, tables = [], activeOrders = {}) {
    return groupAccountTables(group, tables, activeOrders)[0] || groupAnchor(group, tables);
}

/** Map of table id -> group for the tables that belong to an active group. */
export function groupMembership(tables = []) {
    const map = {};
    for (const table of tables || []) {
        if (table?.group?.id) map[table.id] = table.group;
    }
    return map;
}

/**
 * Why the current selection cannot be joined, or null when it can.
 * Mirrors POST /table-groups.
 */
export function selectionProblem(tables = [], activeOrders = {}, selectedIds = []) {
    const selected = (tables || []).filter((table) => selectedIds.includes(table.id));
    if (selected.length < 2) return 'Seleccioná al menos dos mesas para unirlas';
    const branch = selected[0].branch_id;
    if (selected.some((table) => table.branch_id !== branch)) {
        return 'Las mesas deben pertenecer a la misma sucursal';
    }
    const grouped = selected.find((table) => table.group?.id);
    if (grouped) return `La mesa ${grouped.number} ya está unida a otro grupo`;
    const foreignVisit = selected.find((table) => !tableHasAccount(table, activeOrders)
        && (table.active_attention_id || table.active_order));
    if (foreignVisit) return `La mesa ${foreignVisit.number} tiene una visita en curso`;
    const unavailable = selected.find((table) => !tableHasAccount(table, activeOrders)
        && !JOINABLE_TABLE_STATUSES.includes(table.status));
    if (unavailable) return `La mesa ${unavailable.number} no está disponible para unir`;
    return null;
}

export function canJoinSelection(tables = [], activeOrders = {}, selectedIds = []) {
    return selectionProblem(tables, activeOrders, selectedIds) === null;
}

/** Free tables of the same branch that can receive an open visit. */
export function transferCandidates(tables = [], activeOrders = {}, sourceTable = null) {
    if (!sourceTable) return [];
    return (tables || [])
        .filter((table) => (
            table.id !== sourceTable.id
            && table.branch_id === sourceTable.branch_id
            && !table.group?.id
            && !tableHasAccount(table, activeOrders)
            && !table.active_attention_id
            && TRANSFERABLE_TABLE_STATUSES.includes(table.status)
        ))
        .sort((a, b) => Number(a.number) - Number(b.number));
}

/** Why the visit of this table cannot be moved, or null when it can. */
export function transferProblem(sourceTable, activeOrders = {}) {
    if (!sourceTable) return 'Elegí una mesa';
    if (!tableHasAccount(sourceTable, activeOrders)) return 'La mesa no tiene un pedido activo para mover';
    if (sourceTable.group?.id) return 'Separala del grupo de mesas antes de mover el pedido';
    return null;
}

export function canTransferVisit(sourceTable, activeOrders = {}) {
    return transferProblem(sourceTable, activeOrders) === null;
}
