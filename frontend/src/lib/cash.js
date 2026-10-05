import { ORDER_TYPE_LABELS } from '@/lib/format';

export function round2(n) {
    return Math.round(Number(n || 0) * 100) / 100;
}

export function equalShare(remaining, n) {
    const parts = Math.max(1, Number(n) || 1);
    if (parts <= 1) return round2(remaining);
    return Math.floor((Number(remaining) / parts) * 100) / 100;
}

export function newIdempotencyKey() {
    return (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
}

export function accountLabel(order) {
    // Never fall back to the table id: a truncated uuid means nothing to the cashier.
    if (order.table_id) {
        const table = order.table_number ? `Mesa ${order.table_number}` : 'Mesa';
        const ref = order.order_number ? ` · #${order.order_number}` : '';
        return `${table}${ref}`;
    }
    if (order.source === 'public') return `Pedido web #${order.order_number}${order.customer_name ? ` — ${order.customer_name}` : ''}`;
    return `${ORDER_TYPE_LABELS[order.order_type] || 'Pedido'} #${order.order_number}`;
}

/**
 * Strict decimal parser (ported from the cobro prototype's parseCents): rejects
 * negatives, exponent notation and more than two decimals. Returns a number in
 * soles, 0 for an empty value when emptyAsZero is true, or null when invalid.
 */
export function parseAmount(raw, emptyAsZero = false) {
    const value = String(raw ?? '').trim().replace(',', '.');
    if (!value) return emptyAsZero ? 0 : null;
    if (!/^\d{1,6}(?:\.\d{0,2})?$/.test(value)) return null;
    return Number(value);
}
