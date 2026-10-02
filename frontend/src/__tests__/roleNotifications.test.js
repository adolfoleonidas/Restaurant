import { buildRoleNotifications } from '@/lib/roleNotifications';

const order = (overrides = {}) => ({
    id: 'order-1', order_number: 17, status: 'en_preparacion',
    table_id: 'table-1', table_number: 4, items: [], created_at: '2026-10-01T10:00:00Z',
    ...overrides,
});

describe('role notification projection', () => {
    it('alerts mozo/admin once for each explicitly ready item in a partial order', () => {
        const value = order({ items: [
            { id: 'item-a', product_name: 'Lomo', quantity: 2, status: 'listo', ready_at: '2026-10-01T11:00:00Z' },
            { id: 'item-b', product_name: 'Sopa', quantity: 1, status: 'en_preparacion' },
        ] });
        const alerts = buildRoleNotifications('mozo', [value]);
        expect(alerts).toHaveLength(1);
        expect(alerts[0]).toMatchObject({ id: 'listo-item-item-a', type: 'kitchen_ready', title: expect.stringContaining('Lomo'), body: expect.stringContaining('2× Lomo'), href: '/pedidos/order-1', at: '2026-10-01T11:00:00Z' });
        expect(buildRoleNotifications('admin', [value])).toHaveLength(1);
        expect(buildRoleNotifications('cajero', [value])).toHaveLength(0);
    });

    it('keeps item identities stable across polls, ready timestamps, and sibling lifecycle changes', () => {
        const ready = { id: 'item-a', product_name: 'Lomo', quantity: 2, status: 'listo', ready_at: '2026-10-01T11:00:00Z' };
        const first = buildRoleNotifications('mozo', [order({ items: [ready, { id: 'sibling', status: 'en_preparacion' }] })])[0];
        const later = buildRoleNotifications('mozo', [order({ items: [{ ...ready, ready_at: '2026-10-01T12:00:00Z' }, { id: 'sibling', status: 'listo' }] })])[0];
        expect(later.id).toBe(first.id);
        expect(later.at).not.toBe(first.at);
    });

    it('distinguishes same-product items by canonical UUID and deduplicates repeated canonical item records', () => {
        const a = { id: 'item-a', product_name: 'Agua', quantity: 1, status: 'listo' };
        const b = { id: 'item-b', product_name: 'Agua', quantity: 1, status: 'listo' };
        expect(buildRoleNotifications('mozo', [order({ items: [a, b, a] })]).map((n) => n.id)).toEqual(['listo-item-item-a', 'listo-item-item-b']);
    });

    it('excludes served, cancelled, and paid orders and keeps the legacy whole-order ready alert', () => {
        const ready = order({ status: 'listo', items: [{ id: 'x', status: 'listo', product_name: 'Postre', quantity: 1 }] });
        expect(buildRoleNotifications('mozo', [
            ready,
            order({ id: 'served', status: 'entregado', items: [{ id: 'y', status: 'listo' }] }),
            order({ id: 'cancelled', status: 'cancelado', items: [{ id: 'z', status: 'listo' }] }),
            order({ id: 'paid', status: 'pagado', items: [{ id: 'w', status: 'listo' }] }),
        ]).map((n) => n.id)).toEqual(['listo-item-x']);
        expect(buildRoleNotifications('mozo', [order({ id: 'legacy', status: 'listo', items: [{ product_name: 'Pollo', quantity: 1 }] })])[0].id).toBe('listo-legacy');
    });

    it('uses deterministic occurrence fallback for missing item IDs and preserves other alert kinds', () => {
        const legacyItems = [1, 2].map(() => ({ product_name: 'Agua', quantity: 1, status: 'listo' }));
        const legacyAlerts = buildRoleNotifications('mozo', [order({ items: legacyItems })]);
        expect(legacyAlerts.map((n) => n.id)).toEqual(['listo-legacy-item-order-1-Agua-1', 'listo-legacy-item-order-1-Agua-2']);
        const other = buildRoleNotifications('admin', [order({ id: 'other', source: 'public', acceptance_status: 'pendiente', status: 'pendiente_pago', payment_status: 'comprobante_subido' })]);
        expect(other.map((n) => [n.id, n.type])).toEqual([
            ['aceptar-other', 'web_pending'], ['comp-other', 'web_proof'], ['cobro-other', 'cobro'], ['cuenta-other', 'bill'],
        ]);
    });

    it('keeps a ready legacy line identity when an earlier same-descriptor line changes lifecycle', () => {
        const firstLine = { product_name: 'Agua', quantity: 1, status: 'listo' };
        const secondLine = { product_name: 'Agua', quantity: 1, status: 'listo' };
        const initiallyReady = buildRoleNotifications('mozo', [order({ items: [firstLine, secondLine] })]);
        expect(initiallyReady.map((notification) => notification.id)).toEqual([
            'listo-legacy-item-order-1-Agua-1',
            'listo-legacy-item-order-1-Agua-2',
        ]);

        const afterFirstServed = buildRoleNotifications('mozo', [order({ items: [
            { ...firstLine, status: 'servido' },
            secondLine,
        ] })]);
        expect(afterFirstServed).toHaveLength(1);
        expect(afterFirstServed[0].id).toBe(initiallyReady[1].id);
    });
});
