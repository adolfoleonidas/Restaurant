import { activeAttentionOrder, canCloseAttention, canRequestBill, isSettled } from '@/lib/attentionClose';

describe('active table attention presentation', () => {
    const table = { id: 'table-1', active_attention_id: 'visit-2' };
    const delivered = {
        id: 'order-2', table_id: 'table-1', attention_id: 'visit-2', attention_state: 'open',
        status: 'pagado', payment_status: 'pagado', total: 25, amount_paid: 25,
        items: [{ status: 'entregado' }],
    };

    it('selects only the order bound to the table current visit, never historical paid orders', () => {
        const historical = { ...delivered, id: 'old', attention_id: 'visit-1' };
        expect(activeAttentionOrder(table, [historical, delivered])).toBe(delivered);
        expect(activeAttentionOrder({ id: 'table-1' }, [historical])).toBeNull();
    });

    it('never takes an account that is already closed as the table live account', () => {
        // El servidor lista por fecha descendente: la cuenta ya cobrada suele
        // llegar primero. Si la tarjeta la toma a ella, "Entregar" responde "el
        // pedido ya está cerrado" aunque la mesa tenga platos por servir.
        const paidFirst = { ...delivered, id: 'order-9' };
        const idle = {
            ...delivered, id: 'order-4', status: 'entregado', payment_status: 'pendiente',
            amount_paid: 0, items: [{ status: 'entregado' }],
        };
        const withReady = {
            ...delivered, id: 'order-3', status: 'listo', payment_status: 'pendiente',
            amount_paid: 0, items: [{ status: 'listo' }],
        };
        expect(activeAttentionOrder(table, [paidFirst, idle])).toBe(idle);
        expect(activeAttentionOrder(table, [paidFirst, idle, withReady])).toBe(withReady);
        // Con todas las cuentas cerradas la visita sigue teniendo representante,
        // así la mesa todavía se puede finalizar.
        expect(activeAttentionOrder(table, [paidFirst])).toBe(paidFirst);
        const cancelled = { ...paidFirst, id: 'order-8', status: 'cancelado', payment_status: 'pendiente', amount_paid: 0 };
        expect([paidFirst, cancelled]).toContain(activeAttentionOrder(table, [cancelled, paidFirst]));
    });

    it('allows explicit close only after verified payment and completed food', () => {
        expect(canCloseAttention(table, delivered)).toBe(true);
        expect(canCloseAttention(table, { ...delivered, items: [{ status: 'listo' }] })).toBe(false);
        expect(canCloseAttention(table, { ...delivered, payment_status: 'comprobante_subido' })).toBe(false);
        expect(canCloseAttention(table, { ...delivered, amount_paid: 0 })).toBe(false);
        expect(canCloseAttention(table, { ...delivered, attention_state: 'mutating' })).toBe(false);
    });

    it('allows an unpaid cancellation only when it has no unresolved proof or funds', () => {
        const cancelled = { ...delivered, status: 'cancelado', payment_status: 'pendiente', amount_paid: 0, items: [{ status: 'cancelado' }] };
        expect(canCloseAttention(table, cancelled)).toBe(true);
        expect(canCloseAttention(table, { ...cancelled, payment_status: 'comprobante_subido' })).toBe(false);
        expect(canCloseAttention(table, { ...cancelled, amount_paid: 1 })).toBe(false);
    });

    it('lets a table go when every dish was voided and there is nothing to charge', () => {
        // Anular todos los platos deja total 0 **sin** cancelar el pedido. Antes
        // el cierre exigía un pago que ya no existía, así que «Finalizar mesa»
        // desaparecía y la mesa no tenía ninguna salida desde el piso.
        const everythingVoided = {
            ...delivered, status: 'enviado_cocina', payment_status: 'pendiente',
            total: 0, amount_paid: 0, items: [{ status: 'cancelado' }],
        };
        expect(canCloseAttention(table, everythingVoided)).toBe(true);

        // Y lo que sigue bloqueado, que es lo que protege el dinero.
        expect(canCloseAttention(table, { ...everythingVoided, total: 25 })).toBe(false);
        expect(canCloseAttention(table, { ...everythingVoided, payment_status: 'comprobante_subido' })).toBe(false);
        expect(canCloseAttention(table, { ...everythingVoided, items: [{ status: 'listo' }] })).toBe(false);
        expect(canCloseAttention(table, { ...everythingVoided, amount_paid: 5 })).toBe(false);
    });

    it('does not offer the close when another account of the visit is not ready', () => {
        // El servidor exige que **todas** las cuentas de la visita estén
        // liquidadas (`attention.py:444-451`). Sin mirarlas, el botón se ofrecía
        // y el cierre respondía «La cuenta #N no está lista».
        const sibling = {
            ...delivered, id: 'order-3', status: 'entregado', payment_status: 'pendiente',
            total: 18, amount_paid: 0, items: [{ status: 'entregado' }],
        };
        expect(canCloseAttention(table, delivered, [sibling])).toBe(false);
        // Con la cuenta hermana cobrada, el cierre vuelve.
        const paidSibling = { ...sibling, status: 'pagado', payment_status: 'pagado', amount_paid: 18 };
        expect(canCloseAttention(table, delivered, [paidSibling])).toBe(true);
        // Una hermana anulada y sin dinero tampoco bloquea.
        const cancelledSibling = { ...sibling, status: 'cancelado', total: 0, items: [{ status: 'cancelado' }] };
        expect(canCloseAttention(table, delivered, [cancelledSibling])).toBe(true);
        // Y sin la lista, el comportamiento de antes no cambia.
        expect(canCloseAttention(table, delivered)).toBe(true);
    });

    it('sin control de pagos solo exige que la visita esté abierta', () => {
        // Modo «solo pedidos»: cuenta impaga y comida sin entregar no bloquean.
        const unpaid = {
            ...delivered, status: 'entregado', payment_status: 'pendiente',
            amount_paid: 0, items: [{ status: 'listo' }],
        };
        expect(canCloseAttention(table, unpaid)).toBe(false);
        expect(canCloseAttention(table, unpaid, null, { requirePayment: false })).toBe(true);
        expect(canCloseAttention(table, unpaid, [{ id: 'otra' }], { requirePayment: false })).toBe(true);
        // La visita tiene que seguir abierta: eso no lo relaja el modo.
        expect(canCloseAttention(table, { ...unpaid, attention_state: 'closed' }, null, { requirePayment: false })).toBe(false);
    });

    it('reads the same settlement rule the server applies', () => {
        expect(isSettled(delivered)).toBe(true);
        expect(isSettled({ ...delivered, amount_paid: 0 })).toBe(false);
        expect(isSettled({ ...delivered, payment_status: 'parcial', amount_paid: 10 })).toBe(false);
        expect(isSettled({ ...delivered, payment_status: 'comprobante_subido' })).toBe(false);
        expect(isSettled(null)).toBe(false);
    });
});

describe('asking for the bill', () => {
    it('is offered only once the food is out and it has not been asked yet', () => {
        expect(canRequestBill({ status: 'listo' })).toBe(true);
        expect(canRequestBill({ status: 'entregado' })).toBe(true);
        // Todavía en cocina, o ya pedida, o ya cerrada: no.
        expect(canRequestBill({ status: 'en_preparacion' })).toBe(false);
        expect(canRequestBill({ status: 'listo' }, { billRequested: true })).toBe(false);
        expect(canRequestBill({ status: 'pagado' })).toBe(false);
        expect(canRequestBill(null)).toBe(false);
    });
});
