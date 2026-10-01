const ACTIVE_ATTENTION_STATES = new Set(['opening', 'open', 'mutating', 'closing']);
const COMPLETED_FOOD_STATES = new Set(['entregado', 'cancelado']);

export function activeAttentionOrder(table, orders = []) {
    if (!table?.active_attention_id) return null;
    return orders.find((order) => (
        order.table_id === table.id
        && order.attention_id === table.active_attention_id
        && ACTIVE_ATTENTION_STATES.has(order.attention_state)
    )) || null;
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
