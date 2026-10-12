import {
    ORDER_STATUS_LABELS,
    TABLE_STATUS_LABELS,
    PAYMENT_RECORD_STATUS_LABELS,
    ORDER_PAYMENT_LABELS,
    PROOF_PENDING_LABEL,
    orderPaymentStatusLabel,
    PAYMENT_STATE_LABELS,
    PAYMENT_STATE_TONES,
    TRACKING_STEPS,
    LOCAL_TRACKING_STEPS,
    RECOJO_TRACKING_STEPS,
    trackingStepsFor,
    trackingStepIndex,
    LIVE_ITEM_CHIPS,
    TABLE_STATE_CLASS,
    ORDER_STATE_CLASS,
    TABLE_STATE_DOT,
    ORDER_STATE_DOT,
} from '@/constants/status';

describe('status constants', () => {
    test('order and table labels keep today\'s Spanish copy', () => {
        expect(ORDER_STATUS_LABELS).toEqual({
            nuevo: 'Nuevo',
            enviado_cocina: 'Enviado a cocina',
            en_preparacion: 'En preparación',
            listo: 'Listo',
            entregado: 'Entregado',
            pendiente_pago: 'Pendiente de pago',
            pagado: 'Pagado',
            cancelado: 'Cancelado',
        });
        expect(TABLE_STATUS_LABELS).toEqual({
            disponible: 'Disponible',
            ocupada: 'Ocupada',
            esperando_pago: 'Esperando pago',
            reservada: 'Reservada',
            inactiva: 'Inactiva',
            pagada: 'Pagada',
        });
    });

    test('payment record labels', () => {
        expect(PAYMENT_RECORD_STATUS_LABELS).toEqual({
            completed: 'Completado', voiding: 'Anulación en curso', voided: 'Anulado', refunded: 'Devuelto',
        });
    });

    test('order payment labels and the proof-aware label', () => {
        expect(ORDER_PAYMENT_LABELS.comprobante_subido).toBe('Comprobante pendiente de revisión');
        expect(PROOF_PENDING_LABEL).toBe('Pendiente de revisión');
        expect(orderPaymentStatusLabel({ payment_proof_status: 'pendiente', payment_status: 'pagado' })).toBe('Pendiente de revisión');
        expect(orderPaymentStatusLabel({ payment_proof_status: 'aprobado', payment_status: 'pagado' })).toBe('Pagado');
        expect(orderPaymentStatusLabel({ payment_status: 'comprobante_subido' })).toBe('Pendiente de revisión');
        expect(orderPaymentStatusLabel({ payment_status: 'parcial' })).toBe('Pago parcial');
        expect(orderPaymentStatusLabel({ payment_status: 'confirmado' })).toBe('Confirmado');
        expect(orderPaymentStatusLabel({ payment_status: 'otro' })).toBe('otro');
        expect(orderPaymentStatusLabel({})).toBe('—');
        expect(orderPaymentStatusLabel(null)).toBe('—');
    });

    test('public payment state copy and tones', () => {
        expect(PAYMENT_STATE_LABELS.reportado).toBe('Comprobante en revisión: el restaurante está verificando tu pago');
        expect(PAYMENT_STATE_LABELS.no_requerido).toBe('Se paga al final');
        expect(Object.keys(PAYMENT_STATE_TONES).sort()).toEqual(['confirmado', 'expirado', 'rechazado', 'reportado']);
    });

    test('tracking steps keep order, labels and icon keys', () => {
        expect(TRACKING_STEPS.map((s) => [s.key, s.label, s.icon])).toEqual([
            ['nuevo', 'Pedido recibido', 'check'],
            ['en_preparacion', 'En preparación', 'chef'],
            ['listo', 'Listo', 'bell'],
            ['entregado', 'Entregado / En camino', 'truck'],
            ['pagado', 'Completado', 'check'],
        ]);
        expect(LOCAL_TRACKING_STEPS.map((s) => [s.key, s.label, s.icon])).toEqual([
            ['nuevo', 'Pedido recibido', 'check'],
            ['en_preparacion', 'En preparación', 'chef'],
            ['listo', 'Listo', 'bell'],
            ['servido', 'Servido', 'utensils'],
            ['pagado', 'Pagado', 'check'],
        ]);
        expect(RECOJO_TRACKING_STEPS.map((s) => [s.key, s.label, s.icon])).toEqual([
            ['nuevo', 'Pedido recibido', 'check'],
            ['en_preparacion', 'En preparación', 'chef'],
            ['listo', 'Listo', 'bell'],
            ['entregado', 'Recogido', 'bag'],
            ['pagado', 'Completado', 'check'],
        ]);
        expect(trackingStepsFor('local')).toBe(LOCAL_TRACKING_STEPS);
        expect(trackingStepsFor('recojo')).toBe(RECOJO_TRACKING_STEPS);
        expect(trackingStepsFor('delivery')).toBe(TRACKING_STEPS);
        expect(trackingStepsFor(undefined)).toBe(TRACKING_STEPS);
    });

    test('tracking step index maps order status to a step', () => {
        expect(trackingStepIndex('nuevo')).toBe(0);
        expect(trackingStepIndex('enviado_cocina')).toBe(1);
        expect(trackingStepIndex('en_preparacion')).toBe(1);
        expect(trackingStepIndex('listo')).toBe(2);
        expect(trackingStepIndex('entregado')).toBe(3);
        expect(trackingStepIndex('pendiente_pago')).toBe(3);
        expect(trackingStepIndex('pagado')).toBe(4);
        expect(trackingStepIndex('cancelado')).toBe(0);
    });

    test('live item chips', () => {
        expect(Object.entries(LIVE_ITEM_CHIPS).map(([k, c]) => [k, c.label])).toEqual([
            ['pendiente', 'nuevo'],
            ['en_preparacion', 'en cocina'],
            ['listo', 'listo'],
            ['entregado', 'servido'],
        ]);
        expect(LIVE_ITEM_CHIPS.listo.cls).toBe('bg-[#E6F2FF] text-[#0B3A66]');
    });

    test('state badge class and dot maps', () => {
        expect(TABLE_STATE_CLASS.esperando_pago).toBe('state-esperando');
        expect(ORDER_STATE_CLASS.cancelado).toBe('state-cancelada');
        expect(TABLE_STATE_DOT.disponible).toBe('#22C55E');
        expect(ORDER_STATE_DOT.entregado).toBe('#0EA5E9');
    });
});
