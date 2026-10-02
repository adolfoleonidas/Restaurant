export function itemsReadyToClose(order) {
    const items = order?.items;
    if (!Array.isArray(items) || items.length === 0) return false;
    return items.every((it) => it.status === 'entregado' || it.status === 'cancelado');
}

export function balanceDue(order) {
    const total = Number(order?.total || 0);
    const paid = Number(order?.amount_paid || 0);
    return Math.round((total - paid) * 100) / 100;
}

export function paymentAwaitingCheck(order) {
    const due = Number(order?.total || 0) - Number(order?.amount_paid || 0);
    return ['comprobante_subido', 'confirmado'].includes(order?.payment_status) && due > 0.009;
}

export function canCloseAttention(user) {
    return ['admin', 'mozo', 'cajero'].includes(user?.role);
}

export function postCloseAttention(api, order) {
    const due = balanceDue(order);
    const body = {};
    if (due > 0.009) {
        body.method = 'efectivo';
        body.amount = due;
        body.received_amount = due;
        body.idempotency_key = typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `close-${Date.now()}`;
    }
    return api.post(`/orders/${order.id}/close-attention`, body);
}
