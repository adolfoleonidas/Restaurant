export const CURRENCY = 'S/';

/** "1 plato" / "3 platos": the count with its noun in agreement. */
export const countOf = (n, one, many) => `${n} ${Number(n) === 1 ? one : many}`;

export const fmtMoney = (n) => {
    const v = Number(n || 0);
    return `${CURRENCY} ${v.toFixed(2)}`;
};

export const fmtMoneyNum = (n) => {
    const v = Number(n || 0);
    return v.toFixed(2);
};

export const fmtTime = (iso) => {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        return d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
};

export const fmtDateTime = (iso) => {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        return d.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
};

/** Same date-time format as fmtDateTime ("04/03/2026, 10:07"). Accepts an ISO string or a Date. */
export const fmtDateFull = (value) => fmtDateTime(value);

/** Same format for server timestamps. Dash when empty; falls back to the raw value. */
export const fmtDateTimeShort = (iso) => {
    if (!iso) return '—';
    return fmtDateTime(iso) || iso;
};

/** Weekday heading used to group history by day ("mié, 04 mar"). Dash when empty. */
export const fmtDayLabel = (iso) => (
    iso ? new Date(iso).toLocaleDateString('es-PE', { weekday: 'short', day: '2-digit', month: 'short' }) : '—'
);

export const elapsedMinutes = (iso) => {
    if (!iso) return 0;
    try {
        const d = new Date(iso);
        return Math.floor((Date.now() - d.getTime()) / 60000);
    } catch (e) { return 0; }
};

export const fmtElapsed = (iso) => {
    const m = elapsedMinutes(iso);
    if (m < 1) return 'ahora';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return `${h}h ${rem}m`;
};

export const ROLE_LABELS = {
    admin: 'Administrador',
    cajero: 'Cajero',
    mozo: 'Mozo',
    cocina: 'Cocina',
};

export const PAYMENT_LABELS = {
    efectivo: 'Efectivo',
    yape: 'Yape',
    plin: 'Plin',
    tarjeta: 'Tarjeta',
    transferencia: 'Transferencia',
    mixto: 'Mixto',
};

export const ORDER_TYPE_LABELS = {
    mesa: 'Mesa',
    local: 'En local',
    llevar: 'Llevar',
    recojo: 'Recojo',
    delivery: 'Delivery',
};

/**
 * Sales areas the waiter picks before taking an order. Labels come from
 * ORDER_TYPE_LABELS so there is a single source of truth; order matters because
 * it is the order shown on the touch grid (dine-in first).
 */
export const ORDER_AREAS = [
    { key: 'mesa', hint: 'Ocupa una mesa del salón' },
    { key: 'llevar', hint: 'Se lo lleva del mostrador' },
    { key: 'recojo', hint: 'Lo recoge más tarde' },
    { key: 'delivery', hint: 'Con envío a domicilio' },
];

export function waMeLink(phone, text) {
    const n = String(phone || '').replace(/\D/g, '');
    if (!n) return null;
    return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
