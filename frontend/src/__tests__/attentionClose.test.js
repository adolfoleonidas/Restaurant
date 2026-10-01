import { activeAttentionOrder, canCloseAttention } from '@/lib/attentionClose';

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
});
