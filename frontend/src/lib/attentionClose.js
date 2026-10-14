const ACTIVE_ATTENTION_STATES = new Set(['opening', 'open', 'mutating', 'closing']);
const COMPLETED_FOOD_STATES = new Set(['entregado', 'cancelado']);
const CLOSED_ORDER_STATES = new Set(['pagado', 'cancelado']);
const PROOF_STATES = ['comprobante_subido', 'confirmado'];
// La cuenta se cobró entera: nada pendiente de verificar y el dinero cubre el total.
const UNSETTLED_CANCELLED = ['pendiente', 'cancelado', undefined, null];

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

/** Todo lo que la visita tiene que haber terminado de servir. */
function foodIsDone(order) {
    const items = order.items || [];
    if (items.some((item) => !COMPLETED_FOOD_STATES.has(item.status || 'pendiente'))) return false;
    // Una cuenta sin platos no se cierra, salvo que esté anulada.
    return order.status === 'cancelado' || items.length > 0;
}

/**
 * Si la cuenta está liquidada, espejo de `close_block_reason` del servidor
 * (`attention.py`). Las dos reglas tienen que decir lo mismo o el botón aparece
 * y la acción falla.
 */
export function isSettled(order) {
    if (!order) return false;
    if (PROOF_STATES.includes(order.payment_status)) return false;
    const paid = Number(order.amount_paid || 0);
    if (order.status === 'cancelado') {
        return UNSETTLED_CANCELLED.includes(order.payment_status) && paid <= 0.009;
    }
    const total = Number(order.total || 0);
    // Sin nada que cobrar ya está liquidada: se anularon todos los platos y no
    // entró dinero. Sin esto la mesa quedaba atrapada —el pedido no está
    // «cancelado», así que se exigía un pago que ya no existe— y el mozo no tenía
    // ninguna salida desde el piso.
    if (total <= 0.009 && paid <= 0.009) return true;
    return order.payment_status === 'pagado' && paid + 0.009 >= total;
}

/**
 * Si la mesa se puede finalizar.
 *
 * `visitOrders` son las **demás** cuentas de la visita: el servidor exige que
 * todas estén listas antes de cerrar (`attention.py:444-451`) y sin mirarlas el
 * botón se ofrecía y el cierre respondía «La cuenta #N no está lista».
 */
export function canCloseAttention(table, order, visitOrders = null) {
    if (!order || activeAttentionOrder(table, [order]) !== order) return false;
    if (!['open', 'closing'].includes(order.attention_state)) return false;
    if (!foodIsDone(order) || !isSettled(order)) return false;
    if (visitOrders && visitOrders.length) {
        return visitOrders.every((sibling) => (
            sibling.id === order.id || (foodIsDone(sibling) && isSettled(sibling))
        ));
    }
    return true;
}

/**
 * Si se puede pedir la cuenta. Lo comparten la tarjeta del piso y la hoja: la
 * tarjeta no lo ofrecía en «Entregado» —el estado donde es *el* paso siguiente—
 * así que el mozo tenía que abrir mesa por mesa para pedir la cuenta.
 */
export function canRequestBill(order, { billRequested = false } = {}) {
    if (!order || billRequested) return false;
    return ['listo', 'entregado'].includes(order.status);
}
