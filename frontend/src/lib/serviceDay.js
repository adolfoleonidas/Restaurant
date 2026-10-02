const LIMA_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

function limaDayKey(value) {
    const parts = LIMA_DATE_FORMATTER.formatToParts(value);
    const part = (type) => parts.find((entry) => entry.type === type)?.value;
    const year = part('year');
    const month = part('month');
    const day = part('day');
    return year && month && day ? `${year}-${month}-${day}` : null;
}

function limaDay(value) {
    if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return null;
    return limaDayKey(timestamp);
}

function readyTimestamp(order) {
    if (order.ready_at) return order.ready_at;
    const timestamps = (order.items || [])
        .filter((item) => item.status === 'listo' && item.ready_at)
        .map((item) => item.ready_at)
        .filter((value) => limaDay(value))
        .sort((a, b) => Date.parse(a) - Date.parse(b));
    return timestamps.at(-1) || null;
}

export function partitionPriorPickupOrders(orders, now = new Date()) {
    const today = Number.isFinite(now?.getTime?.()) ? limaDayKey(now) : null;
    const live = [];
    const prior = [];

    for (const order of orders || []) {
        const readyDay = order.order_type === 'recojo' && !order.table_id && order.status === 'listo'
            ? limaDay(readyTimestamp(order))
            : null;
        if (today && readyDay && readyDay < today) prior.push(order);
        else live.push(order);
    }

    return { live, prior };
}
