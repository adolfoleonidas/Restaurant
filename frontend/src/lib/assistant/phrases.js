/**
 * Assistant phrase catalog and event → announcement mapping (pure, no DOM).
 *
 * Kept framework-free so it can be unit tested and reused by any provider
 * (browser speech synthesis today, a server-side speaker tomorrow).
 */

export const PRIORITY = { info: 0, order: 1, attention: 2 };

const ROLE_SCOPE = {
    bill: ['admin', 'mozo', 'cajero'],
    new_order: ['admin', 'cocina'],
    ready: ['admin', 'mozo'],
};

function plural(count, one, many) {
    return `${count} ${count === 1 ? one : many}`;
}

/**
 * Maps a backend bus event to a pending announcement descriptor.
 * Text is resolved later (it may need a table lookup), so this stays pure.
 */
export function pendingAnnouncement(event, role) {
    if (!event || !role) return null;

    if (event.type === 'table' && event.status === 'esperando_pago' && ROLE_SCOPE.bill.includes(role)) {
        return { key: `bill:${event.table_id}`, kind: 'bill', refId: event.table_id, priority: PRIORITY.attention };
    }

    if (event.type === 'order' && event.status === 'enviado_cocina' && ROLE_SCOPE.new_order.includes(role)) {
        return { key: `new:${event.order_id}`, kind: 'new_order', refId: event.order_id, priority: PRIORITY.order };
    }

    if (event.type === 'order' && event.status === 'listo' && ROLE_SCOPE.ready.includes(role)) {
        return { key: `ready:${event.order_id}`, kind: 'ready', refId: event.order_id, priority: PRIORITY.order };
    }

    return null;
}

/** Builds the spoken text for a descriptor. `table`/`count` are best effort. */
export function textFor(item, { table, count } = {}) {
    if (!item) return null;
    switch (item.kind) {
        case 'new_order':
            if (!table) return 'Nuevo pedido en cocina';
            return count
                ? `Nuevo pedido, mesa ${table}, ${plural(count, 'plato', 'platos')}`
                : `Nuevo pedido, mesa ${table}`;
        case 'ready':
            return table ? `Mesa ${table} lista para entregar` : 'Un pedido está listo para entregar';
        case 'bill':
            return table ? `Mesa ${table} pidió la cuenta` : 'Una mesa pidió la cuenta';
        default:
            return null;
    }
}
