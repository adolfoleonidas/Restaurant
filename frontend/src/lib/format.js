export const CURRENCY = 'S/';

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

export const ORDER_STATUS_LABELS = {
    nuevo: 'Nuevo',
    enviado_cocina: 'Enviado a cocina',
    en_preparacion: 'En preparación',
    listo: 'Listo',
    entregado: 'Entregado',
    pendiente_pago: 'Pendiente de pago',
    pagado: 'Pagado',
    cancelado: 'Cancelado',
};

export const TABLE_STATUS_LABELS = {
    disponible: 'Disponible',
    ocupada: 'Ocupada',
    esperando_pago: 'Esperando pago',
    reservada: 'Reservada',
    inactiva: 'Inactiva',
};
