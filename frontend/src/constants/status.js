/**
 * Single home for status labels, colors and step order. Screens import from
 * here instead of re-declaring their own copies.
 */

// ---- Orders and tables -----------------------------------------------------

export const ORDER_STATUS_LABELS = {
    nuevo: 'Nuevo',
    enviado_cocina: 'Enviado a cocina',
    en_preparacion: 'En preparación',
    listo: 'Listo',
    entregado: 'Entregado',
    pendiente_pago: 'Pendiente de pago',
    pagado: 'Pagado',
    cancelado: 'Anulado',
    // Modo «solo pedidos»: la mesa se liberó sin cobrar en la app.
    cerrado_sin_cobro: 'Cerrada sin cobro',
};

export const TABLE_STATUS_LABELS = {
    disponible: 'Disponible',
    ocupada: 'Ocupada',
    esperando_pago: 'Esperando pago',
    reservada: 'Reservada',
    inactiva: 'Inactiva',
    pagada: 'Pagada',
};

export const TABLE_STATE_CLASS = {
    disponible: 'state-disponible',
    ocupada: 'state-ocupada',
    esperando_pago: 'state-esperando',
    reservada: 'state-reservada',
    inactiva: 'state-inactiva',
};

export const ORDER_STATE_CLASS = {
    nuevo: 'state-nuevo',
    enviado_cocina: 'state-enviado',
    en_preparacion: 'state-preparacion',
    listo: 'state-listo',
    entregado: 'state-entregado',
    pendiente_pago: 'state-esperando',
    pagado: 'state-pagado',
    cancelado: 'state-cancelada',
    cerrado_sin_cobro: 'state-entregado',
};

export const TABLE_STATE_DOT = {
    disponible: '#22C55E', ocupada: '#EF4444', esperando_pago: '#F59E0B',
    reservada: '#8B5CF6', inactiva: '#71717A',
};

export const ORDER_STATE_DOT = {
    nuevo: '#3B82F6', enviado_cocina: '#F59E0B', en_preparacion: '#F59E0B',
    listo: '#3B82F6', entregado: '#0EA5E9', pendiente_pago: '#F59E0B',
    pagado: '#22C55E', cancelado: '#71717A', cerrado_sin_cobro: '#64748B',
};

/** Per-item progress chips shown on the public product card of a live order. */
export const LIVE_ITEM_CHIPS = {
    pendiente: { label: 'nuevo', cls: 'bg-secondary text-muted-foreground' },
    en_preparacion: { label: 'en cocina', cls: 'bg-[#FFF6DB] text-[#6B4E00]' },
    listo: { label: 'listo', cls: 'bg-[#E6F2FF] text-[#0B3A66]' },
    entregado: { label: 'entregado', cls: 'bg-[#E7F6EE] text-[#0F5132]' },
};

// ---- Payments --------------------------------------------------------------

/** Status of a single payment record (cash movement). */
export const PAYMENT_RECORD_STATUS_LABELS = {
    completed: 'Completado',
    voiding: 'Anulación en curso',
    voided: 'Anulado',
    refunded: 'Devuelto',
};

/** Payment status of an order, as the audit trail shows it. */
export const ORDER_PAYMENT_LABELS = {
    pendiente: 'Pendiente',
    parcial: 'Parcial',
    pagado: 'Pagado',
    comprobante_subido: 'Comprobante pendiente de revisión',
    confirmado: 'Confirmado',
    cancelado: 'Anulado',
    anulado: 'Anulado',
    voided: 'Anulado',
    refunded: 'Devuelto',
};

export const PROOF_PENDING_LABEL = 'Pendiente de revisión';

const PROOF_UPLOADED = 'comprobante_subido';

/**
 * A proof waiting for review. Newer orders track it in `payment_proof_status`
 * so a partial payment cannot hide it; legacy ones only had `payment_status`.
 */
export function proofPending(row) {
    return row?.payment_proof_status
        ? row.payment_proof_status === 'pendiente'
        : row?.payment_status === PROOF_UPLOADED;
}

const PROOF_ROW_LABELS = {
    pagado: 'Pagado',
    parcial: 'Pago parcial',
    confirmado: 'Confirmado',
};

/** Label for a row of the proofs list (proof review wins over payment status). */
export function orderPaymentStatusLabel(row) {
    if (proofPending(row)) return PROOF_PENDING_LABEL;
    const status = row?.payment_status;
    return PROOF_ROW_LABELS[status] || status || '—';
}

/** Public tracking: what the customer reads about their payment. */
export const PAYMENT_STATE_LABELS = {
    pendiente: 'Pendiente de pago',
    reportado: 'Comprobante en revisión: el restaurante está verificando tu pago',
    confirmado: 'Pago confirmado ✓',
    rechazado: 'Pago rechazado: no pudimos verificar el pago',
    expirado: 'Pago vencido',
    reembolsado: 'Pago reembolsado',
    no_requerido: 'Se paga al final',
};

export const PAYMENT_STATE_TONES = {
    confirmado: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
    rechazado: 'border-destructive/40 bg-destructive/10 text-destructive',
    expirado: 'border-destructive/40 bg-destructive/10 text-destructive',
    reportado: 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200',
};

// ---- Public tracking steps -------------------------------------------------
// `icon` is a key the page maps to a lucide component, so this module stays
// free of UI imports.

export const TRACKING_STEPS = [
    { key: 'nuevo', label: 'Pedido recibido', icon: 'check' },
    { key: 'en_preparacion', label: 'En preparación', icon: 'chef' },
    { key: 'listo', label: 'Listo', icon: 'bell' },
    { key: 'entregado', label: 'Entregado / En camino', icon: 'truck' },
    { key: 'pagado', label: 'Completado', icon: 'check' },
];

export const LOCAL_TRACKING_STEPS = [
    { key: 'nuevo', label: 'Pedido recibido', icon: 'check' },
    { key: 'en_preparacion', label: 'En preparación', icon: 'chef' },
    { key: 'listo', label: 'Listo', icon: 'bell' },
    { key: 'servido', label: 'Entregado', icon: 'utensils' },
    { key: 'pagado', label: 'Pagado', icon: 'check' },
];

export const RECOJO_TRACKING_STEPS = [
    { key: 'nuevo', label: 'Pedido recibido', icon: 'check' },
    { key: 'en_preparacion', label: 'En preparación', icon: 'chef' },
    { key: 'listo', label: 'Listo', icon: 'bell' },
    { key: 'entregado', label: 'Recogido', icon: 'bag' },
    { key: 'pagado', label: 'Completado', icon: 'check' },
];

export function trackingStepsFor(orderType) {
    if (orderType === 'local') return LOCAL_TRACKING_STEPS;
    if (orderType === 'recojo') return RECOJO_TRACKING_STEPS;
    return TRACKING_STEPS;
}

export function trackingStepIndex(status) {
    if (status === 'nuevo') return 0;
    if (status === 'enviado_cocina' || status === 'en_preparacion') return 1;
    if (status === 'listo') return 2;
    if (status === 'entregado' || status === 'pendiente_pago') return 3;
    if (status === 'pagado') return 4;
    return 0;
}
