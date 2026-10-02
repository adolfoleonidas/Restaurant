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

function itemReadyId(order, item, occurrence) {
    if (item.id) return `listo-item-${item.id}`;
    // Legacy lines have no canonical identity; occurrence only disambiguates identical metadata.
    const descriptor = item.product_id || item.product_name || 'item';
    const safeDescriptor = encodeURIComponent(String(descriptor));
    return `listo-legacy-item-${order.id}-${safeDescriptor}-${occurrence}`;
}

export function buildRoleNotifications(role, orders = []) {
    const items = [];
    for (const o of orders) {
        if (!o || o.status === 'pagado' || o.status === 'cancelado') continue;
        const n = o.order_number;
        const body = dishes(o) || who(o);
        const detailHref = role === 'cocina' ? '/cocina' : `/pedidos/${o.id}`;

        if (['mozo', 'admin'].includes(role) && o.source === 'public' && o.acceptance_status === 'pendiente') {
            items.push({
                id: `aceptar-${o.id}`,
                type: 'web_pending',
                title: `Pedido web #${n} espera aceptación`,
                body,
                href: detailHref,
                at: o.created_at,
            });
        }
        if (['cocina', 'admin'].includes(role) && o.acceptance_status !== 'pendiente' && (o.status === 'enviado_cocina' || (o.items || []).some((it) => (it.status || 'pendiente') === 'pendiente'))) {
            const mesa = o.table_number || (o.table_id ? 'mesa' : null);
            items.push({
                id: `pase-${o.id}`,
                type: 'kitchen_new',
                title: mesa ? `Mesa ${mesa}` : `Pedido #${n}`,
                body,
                href: '/cocina',
                at: o.sent_to_kitchen_at || o.created_at,
            });
        }
        const canReceiveReady = ['mozo', 'admin'].includes(role) && o.status !== 'entregado';
        const readyItems = (o.items || []).filter((it) => it.status === 'listo');
        if (canReceiveReady && readyItems.length) {
            const occurrences = new Map();
            for (const item of o.items || []) {
                const descriptor = item.product_id || item.product_name || 'item';
                const occurrence = (occurrences.get(descriptor) || 0) + 1;
                occurrences.set(descriptor, occurrence);
                if (item.status !== 'listo') continue;
                const label = `${item.quantity ?? 1}× ${item.product_name || 'Plato'}`;
                const mesa = o.table_number || (o.table_id ? 'mesa' : null);
                items.push({
                    id: itemReadyId(o, item, occurrence),
                    type: 'kitchen_ready',
                    title: mesa ? `Mesa ${mesa}: ${item.product_name || 'plato'} listo` : `Pedido #${n}: ${item.product_name || 'plato'} listo`,
                    body: `${label} · ${who(o)}`,
                    href: detailHref,
                    at: item.ready_at || o.ready_at || o.updated_at || o.created_at,
                });
            }
        } else if (canReceiveReady && o.status === 'listo' && !(o.items || []).some((it) => it.status)) {
            // Older API projections can omit item status; preserve their whole-order alert.
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
