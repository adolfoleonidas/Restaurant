function dishes(order) {
    return (order.items || [])
        .slice(0, 3)
        .map((it) => `${it.quantity}× ${it.product_name}`)
        .join(', ');
}

function who(order) {
    if (order.customer_name) return order.customer_name;
    if (order.table_id) return order.table_number ? `Mesa ${order.table_number}` : 'Mesa';
    return 'Pedido';
}

export function buildRoleNotifications(role, orders = []) {
    const items = [];
    for (const o of orders) {
        if (!o || o.status === 'pagado' || o.status === 'cancelado') continue;
        const n = o.order_number;
        const body = dishes(o) || who(o);
        const detailHref = role === 'cocina' ? '/cocina' : `/pedidos/${o.id}`;

        if (['cocina', 'admin'].includes(role) && o.status === 'enviado_cocina') {
            items.push({
                id: `pase-${o.id}`,
                type: 'kitchen_new',
                title: `Nuevo pase #${n}`,
                body,
                href: '/cocina',
                at: o.sent_to_kitchen_at || o.created_at,
            });
        }
        if (['mozo', 'admin'].includes(role) && o.status === 'listo') {
            const mesa = o.table_number || (o.table_id ? 'mesa' : null);
            items.push({
                id: `listo-${o.id}`,
                type: 'kitchen_ready',
                title: mesa ? `Mesa ${mesa}: platos listos para recoger` : `Pedido #${n} listo para entregar`,
                body,
                href: detailHref,
                at: o.ready_at || o.updated_at || o.created_at,
            });
        }
        if (['cajero', 'admin'].includes(role) && o.source === 'public' && o.payment_status === 'comprobante_subido') {
            items.push({
                id: `comp-${o.id}`,
                type: 'web_proof',
                title: `Comprobante web #${n}`,
                body: `${who(o)} · revisar en caja`,
                href: '/caja',
                at: o.updated_at || o.created_at,
            });
        }
        if (['cajero', 'admin'].includes(role) && ['pendiente_pago', 'entregado', 'listo'].includes(o.status)) {
            items.push({
                id: `cobro-${o.id}`,
                type: 'cobro',
                title: `Cobrar #${n}`,
                body: `${who(o)} · ${body}`,
                href: '/caja',
                at: o.updated_at || o.created_at,
            });
        }
        if (['mozo', 'admin'].includes(role) && o.status === 'pendiente_pago') {
            items.push({
                id: `cuenta-${o.id}`,
                type: 'bill',
                title: `Cuenta pedida #${n}`,
                body: who(o),
                href: detailHref,
                at: o.updated_at || o.created_at,
            });
        }
    }
    items.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    const seen = new Set();
    return items.filter((it) => {
        if (seen.has(it.id)) return false;
        seen.add(it.id);
        return true;
    }).slice(0, 20);
}
