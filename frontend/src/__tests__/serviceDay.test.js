import { partitionPriorPickupOrders } from '@/lib/serviceDay';

describe('pickup service-day projection', () => {
    const now = new Date('2026-10-01T05:00:00.000Z'); // Lima midnight.
    const order = (overrides) => ({ order_type: 'recojo', status: 'listo', ready_at: '2026-09-30T23:59:59-05:00', ...overrides });

    it('moves only ready recojo orders with a known earlier Lima ready date', () => {
        const yesterday = order({ id: 'yesterday' });
        const today = order({ id: 'today', ready_at: '2026-10-01T00:00:00-05:00' });
        const pending = order({ id: 'pending', status: 'en_preparacion' });
        const delivery = order({ id: 'delivery', order_type: 'delivery' });

        expect(partitionPriorPickupOrders([yesterday, today, pending, delivery], now)).toEqual({
            live: [today, pending, delivery],
            prior: [yesterday],
        });
    });

    it('keeps unknown, invalid, and future ready timestamps in the live pass', () => {
        const orders = [
            order({ id: 'missing', ready_at: undefined }),
            order({ id: 'invalid', ready_at: 'not-a-date' }),
            order({ id: 'naive', ready_at: '2026-09-30T23:00:00' }),
            order({ id: 'future', ready_at: '2026-10-02T00:00:00-05:00' }),
        ];

        expect(partitionPriorPickupOrders(orders, now)).toEqual({ live: orders, prior: [] });
    });

    it('uses item ready stamps when the order-level ready stamp is missing', () => {
        const oldPickup = order({ ready_at: null, items: [{ status: 'listo', ready_at: '2026-09-30T23:00:00Z' }] });
        expect(partitionPriorPickupOrders([oldPickup], now).prior).toEqual([oldPickup]);
    });

    it('does not depend on localized date display ordering', () => {
        const nativeFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima' });
        const formatSpy = jest.spyOn(Intl.DateTimeFormat.prototype, 'format', 'get').mockReturnValue((value) => {
            const parts = nativeFormatter.formatToParts(value);
            const part = (type) => parts.find((entry) => entry.type === type).value;
            return `${part('month')}/${part('day')}/${part('year')}`;
        });
        const yesterday = order({ id: 'localized-yesterday', ready_at: '2026-09-30T23:59:59-05:00' });

        try {
            expect(partitionPriorPickupOrders([yesterday], now).prior).toEqual([yesterday]);
        } finally {
            formatSpy.mockRestore();
        }
    });
});
