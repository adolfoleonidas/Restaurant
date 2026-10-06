const ACTIVE_ATTENTION_STATES = new Set(['opening', 'open', 'mutating', 'closing']);
const COMPLETED_FOOD_STATES = new Set(['entregado', 'cancelado']);
const CLOSED_ORDER_STATES = new Set(['pagado', 'cancelado']);

export function activeAttentionOrder(table, orders = []) {
    if (!table?.active_attention_id) return null;
    const visit = orders.filter((order) => (
        order.table_id === table.id
        && order.attention_id === table.active_attention_id
        && ACTIVE_ATTENTION_STATES.has(order.attention_state)
    ));
    if (visit.length === 0) return null;
    // Una visita puede tener varias cuentas, y las ya cerradas —cobradas o
    // anuladas— siguen perteneciendo a ella. La tarjeta tiene que tomar una
    // cuenta viva: si agarra una cerrada, "Entregar" responde "el pedido ya está
    // cerrado" y el mozo no entiende por qué, con platos de otras cuentas sin
    // servir. Entre las vivas se prefiere la que tiene algo listo para llevar.
    const live = visit.filter((order) => !CLOSED_ORDER_STATES.has(order.status));
    const candidates = live.length ? live : visit;
    return candidates.find((order) => (order.items || []).some((item) => item.status === 'listo'))
        || candidates[0];
}

export function canCloseAttention(table, order) {
    if (!order || activeAttentionOrder(table, [order]) !== order) return false;
    if (!['open', 'closing'].includes(order.attention_state)) return false;
    const items = order.items || [];
    if (items.some((item) => !COMPLETED_FOOD_STATES.has(item.status || 'pendiente'))) return false;
    if (order.status !== 'cancelado' && items.length === 0) return false;
    if (['comprobante_subido', 'confirmado'].includes(order.payment_status)) return false;

    const paid = Number(order.amount_paid || 0);
    if (order.status === 'cancelado') {
        return ['pendiente', 'cancelado', undefined, null].includes(order.payment_status) && paid <= 0.009;
    }
    return order.payment_status === 'pagado' && paid + 0.009 >= Number(order.total || 0);
}
