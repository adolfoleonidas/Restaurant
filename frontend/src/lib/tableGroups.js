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
import { countOf } from '@/lib/format';

const ACTIVE_ATTENTION_STATES = ['opening', 'open', 'mutating', 'closing'];
const SETTLED_ORDER_STATUSES = ['pagado', 'cancelado', 'cerrado_sin_cobro'];
const JOINABLE_TABLE_STATUSES = ['disponible', 'ocupada'];
const TRANSFERABLE_TABLE_STATUSES = ['disponible', 'ocupada'];

/** Same ceiling as `_MAX_GROUP_SIZE`: a party, not a whole room. */
export const GROUP_MAX_MEMBERS = 12;

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
    if (selected.length < 2) return 'Selecciona al menos dos mesas para unirlas';
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

// ── One selection, two operations ─────────────────────────────────────────
//
// "Unir mesas" is really two floor operations behind one gesture, and the mozo
// should not have to know which one they are asking for:
//
//   * a new group, out of tables that belong to nobody yet;
//   * one more table for a group that is already joined (the party grew), which
//     used to force dissolving the group and re-joining every table.
//
// So a selection is just "the things that go together": tables, plus at most one
// existing group. Which endpoint that turns into is derived, never asked.

/** Seats a set of tables holds, or null while any of them does not say. */
export function seatsOf(tables = []) {
    const seats = (tables || []).map((table) => Number(table?.capacity ?? table?.seats ?? 0) || 0);
    if (!seats.length || seats.some((count) => count <= 0)) return null;
    return seats.reduce((sum, count) => sum + count, 0);
}

/** The group of this id, read back from the tables the floor listing carries. */
export function groupById(tables = [], groupId = null) {
    if (!groupId) return null;
    const member = (tables || []).find((table) => table?.group?.id === groupId);
    return member?.group || null;
}

/**
 * The branch of a group, read from one of its member tables: the floor listing
 * sends the group as a marker (id, name, anchor, members) without a branch.
 */
function anchorBranch(group, tables) {
    return (groupAnchor(group, tables) || groupMembers(group, tables)[0])?.branch_id;
}

/** Why the picked tables cannot be added to this group, or null. Mirrors POST /table-groups/:id/tables. */
export function extendProblem(group, tables = [], activeOrders = {}, pickedIds = []) {
    if (!group?.id) return 'Elige un grupo de mesas';
    const picked = (tables || []).filter((table) => pickedIds.includes(table.id));
    if (!picked.length) return 'Elige al menos una mesa para sumarla al grupo';
    const members = groupMembers(group, tables);
    if (members.length + picked.length > GROUP_MAX_MEMBERS) {
        return `Un grupo admite hasta ${GROUP_MAX_MEMBERS} mesas`;
    }
    const branch = anchorBranch(group, tables);
    const foreign = picked.find((table) => table.branch_id !== branch);
    if (foreign) return `La mesa ${foreign.number} es de otra sucursal`;
    const grouped = picked.find((table) => table.group?.id);
    if (grouped) return `La mesa ${grouped.number} ya está unida a otro grupo`;
    const visit = picked.find((table) => !tableHasAccount(table, activeOrders) && table.active_attention_id);
    if (visit) return `La mesa ${visit.number} tiene una visita en curso`;
    const unavailable = picked.find((table) => (
        !tableHasAccount(table, activeOrders) && !JOINABLE_TABLE_STATUSES.includes(table.status)
    ));
    if (unavailable) return `La mesa ${unavailable.number} no está disponible para unir`;
    return null;
}

/**
 * Why this table cannot join the current selection, or null when it can.
 *
 * The floor says this **on the card itself**: with the tables scrolling under a
 * bar pinned to the bottom of the screen, an error that only lives in that bar
 * is read far away from the table that caused it.
 */
export function pickProblem(table, {
    tables = [], activeOrders = {}, pickedIds = [], pickedGroup = null,
} = {}) {
    if (!table) return 'Mesa desconocida';
    // A joined table is picked as its whole group: the mozo means the party.
    if (table.group?.id) {
        if (pickedGroup && pickedGroup.id !== table.group.id) {
            return `Mesas ${groupMembers(pickedGroup, tables).map((m) => m.number).join(' + ')} ya está elegido; quítalo para ampliar este`;
        }
        if (groupMembers(table.group, tables).length >= GROUP_MAX_MEMBERS) {
            return `Este grupo ya tiene ${GROUP_MAX_MEMBERS} mesas`;
        }
        return null;
    }
    const picked = (tables || []).filter((entry) => pickedIds.includes(entry.id));
    const size = pickedGroup ? groupMembers(pickedGroup, tables).length + picked.length + 1 : picked.length + 1;
    if (size > GROUP_MAX_MEMBERS) return `Un grupo admite hasta ${GROUP_MAX_MEMBERS} mesas`;
    const branch = pickedGroup ? anchorBranch(pickedGroup, tables) : picked[0]?.branch_id;
    if (branch && table.branch_id !== branch) return `La mesa ${table.number} es de otra sucursal`;
    // A visit that never produced an order is a table held for somebody else.
    if (!tableHasAccount(table, activeOrders) && table.active_attention_id) {
        return `La mesa ${table.number} tiene una visita en curso`;
    }
    if (!tableHasAccount(table, activeOrders) && !JOINABLE_TABLE_STATUSES.includes(table.status)) {
        return `La mesa ${table.number} no está disponible para unir`;
    }
    return null;
}

/**
 * What the picks mean: `create` a new group, `extend` a joined one, or nothing
 * yet. `issue` is a real problem with the picks — never "you still need one
 * more", which is guidance, not an error.
 */
export function joinOperation({
    tables = [], activeOrders = {}, pickedIds = [], pickedGroupIds = [],
} = {}) {
    const picked = (tables || []).filter((table) => pickedIds.includes(table.id));
    const groups = pickedGroupIds.map((id) => groupById(tables, id)).filter(Boolean);
    if (groups.length > 1) {
        return {
            kind: 'extend', group: null, count: 0, issue: 'Solo se puede ampliar un grupo a la vez', canConfirm: false,
        };
    }
    if (groups.length === 1) {
        const group = groups[0];
        // Adding nothing to a group is not an operation: the group is the pick.
        const issue = picked.length ? extendProblem(group, tables, activeOrders, pickedIds) : null;
        return { kind: 'extend', group, count: picked.length, issue, canConfirm: !issue && picked.length > 0 };
    }
    const issue = picked.length >= 2 ? selectionProblem(tables, activeOrders, pickedIds) : null;
    return {
        kind: 'create', group: null, count: picked.length, issue, canConfirm: !issue && picked.length >= 2,
    };
}

/**
 * Who may read as the group's principal table, mirroring `_resolve_anchor`: when
 * any picked table already holds an account, the principal has to be one of
 * those, so the group is named by the party's own table.
 */
export function anchorCandidates(tables = [], activeOrders = {}, pickedIds = []) {
    const picked = (tables || []).filter((table) => pickedIds.includes(table.id));
    const owners = picked.filter((table) => tableHasAccount(table, activeOrders));
    const pool = owners.length ? owners : picked;
    return pool.slice().sort((a, b) => (
        String(activeOrders?.[a.id]?.created_at || '').localeCompare(String(activeOrders?.[b.id]?.created_at || ''))
        || Number(a.number) - Number(b.number)
    ));
}

/** The principal table the staff reads, falling back to the API's own choice. */
export function resolveAnchor(pickedIds = [], candidates = [], chosen = null) {
    if (chosen && pickedIds.includes(chosen)) return chosen;
    return candidates[0]?.id || null;
}

/**
 * The line that tells the mozo what the next tap is for. It never disappears:
 * it used to be replaced by the list of chosen numbers exactly when one more
 * table was still missing.
 */
export function selectionGuidance({ operation, pickedIds = [], tables = [] } = {}) {
    const label = operation?.group ? groupLabel(operation.group, tables) : null;
    if (operation?.kind === 'extend') {
        // Sin grupo al que apuntar (dos grupos elegidos) la frase se sostiene
        // sola: el aviso de la barra es el que explica qué pasa.
        const target = label ? ` a ${label}` : '';
        if (!pickedIds.length) return `Elige las mesas que se suman${target}`;
        return `${countOf(pickedIds.length, 'mesa', 'mesas')} se suma${pickedIds.length === 1 ? '' : 'n'}${target}`;
    }
    if (pickedIds.length === 0) return 'Elige dos o más mesas para unirlas';
    if (pickedIds.length === 1) return 'Elige al menos una mesa más';
    return `${countOf(pickedIds.length, 'mesa', 'mesas')} para unir en un solo grupo`;
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
    if (!sourceTable) return 'Elige una mesa';
    if (!tableHasAccount(sourceTable, activeOrders)) return 'La mesa no tiene un pedido activo para mover';
    if (sourceTable.group?.id) return 'Sepárala del grupo de mesas antes de mover el pedido';
    return null;
}

export function canTransferVisit(sourceTable, activeOrders = {}) {
    return transferProblem(sourceTable, activeOrders) === null;
}
