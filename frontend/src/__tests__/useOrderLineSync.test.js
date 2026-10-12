/**
 * CP-02: a synced line is confirmed from the write response (POST/PATCH answer
 * with the whole order), so a tap no longer costs a second GET. When the
 * response cannot confirm (no order in it) the hook falls back to one GET.
 */
import { act } from 'react';
import useOrderLineSync from '@/hooks/useOrderLineSync';
import { addOrderItems, removeOrderItem, updateOrderItem } from '@/lib/api/orders';
import { renderHook } from '@/test-utils/renderHook';

jest.mock('@/lib/api/orders', () => ({
    addOrderItems: jest.fn(),
    removeOrderItem: jest.fn(),
    updateOrderItem: jest.fn(),
}));

const sopa = { id: 'p-a', name: 'Sopa', price: 10 };

const line = (extra = {}) => ({
    id: 'a', product_id: 'p-a', product_name: 'Sopa', quantity: 2, unit_price: 10, subtotal: 20, status: 'borrador', notes: null, ...extra,
});
const orderWith = (items) => ({
    id: 'o1', status: 'nuevo', table_id: 't1', items, total: items.reduce((s, i) => s + i.subtotal, 0),
});
const placeholder = { id: null, status: 'nuevo', items: [], total: 0 };

let view;
let loadOrder;
let acceptOrder;
let onSynced;

const mount = async (order = orderWith([line()]), extra = {}) => {
    view = await renderHook((props) => useOrderLineSync(props), {
        order,
        placeholder,
        ensureOrderId: async () => 'o1',
        loadOrder,
        acceptOrder,
        onError: jest.fn(),
        onSynced,
        ...extra,
    });
    return view;
};

const tapAndWait = async (product = sopa, direction = 1) => {
    await act(async () => { await view.result.current.tap(product, direction); });
};

beforeEach(() => {
    loadOrder = jest.fn(async () => orderWith([line({ quantity: 3, subtotal: 30 })]));
    acceptOrder = jest.fn();
    onSynced = jest.fn();
    addOrderItems.mockReset();
    removeOrderItem.mockReset();
    updateOrderItem.mockReset();
});

afterEach(async () => {
    if (view) await view.unmount();
    view = null;
});

describe('useOrderLineSync write confirmation (CP-02)', () => {
    it('confirms an updated line from the PATCH response without re-reading the order', async () => {
        const confirmed = orderWith([line({ quantity: 3, subtotal: 30 })]);
        updateOrderItem.mockResolvedValue({ data: confirmed });
        await mount();

        await tapAndWait();

        expect(updateOrderItem).toHaveBeenCalledWith('o1', 'a', { quantity: 3 });
        expect(loadOrder).not.toHaveBeenCalled();
        expect(acceptOrder).toHaveBeenCalledTimes(1);
        expect(acceptOrder).toHaveBeenCalledWith(confirmed);
        expect(onSynced).toHaveBeenCalledTimes(1);
    });

    it('confirms a removed line from the DELETE response', async () => {
        const confirmed = orderWith([]);
        removeOrderItem.mockResolvedValue({ data: confirmed });
        await mount(orderWith([line({ quantity: 1, subtotal: 10 })]));

        await tapAndWait(sopa, -1);

        expect(removeOrderItem).toHaveBeenCalledWith('o1', 'a');
        expect(loadOrder).not.toHaveBeenCalled();
        expect(acceptOrder).toHaveBeenCalledWith(confirmed);
    });

    it('binds a created line from the POST response', async () => {
        const created = orderWith([line({ id: 'new-line', quantity: 1, subtotal: 10 })]);
        let release;
        addOrderItems.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ data: created }); }));
        updateOrderItem.mockResolvedValue({ data: orderWith([line({ id: 'new-line', quantity: 2, subtotal: 20 })]) });
        await mount(orderWith([]));

        // The first tap is creating the line when the second one arrives.
        await act(async () => { void view.result.current.tap(sopa, 1); });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(addOrderItems).toHaveBeenCalledTimes(1);
        await act(async () => { void view.result.current.tap(sopa, 1); });
        await act(async () => { release(); await view.result.current.flush(); });

        expect(addOrderItems).toHaveBeenCalledTimes(1);
        expect(loadOrder).not.toHaveBeenCalled();
        expect(updateOrderItem).toHaveBeenCalledWith('o1', 'new-line', { quantity: 2 });
    });

    it('falls back to one GET when the response does not carry the order', async () => {
        updateOrderItem.mockResolvedValue({ data: {} });
        await mount();

        await tapAndWait();

        expect(loadOrder).toHaveBeenCalledTimes(1);
        expect(loadOrder).toHaveBeenCalledWith('o1');
        expect(acceptOrder).not.toHaveBeenCalled();
    });

    it('ignores a response for a different order', async () => {
        updateOrderItem.mockResolvedValue({ data: { ...orderWith([line()]), id: 'other' } });
        await mount();

        await tapAndWait();

        expect(acceptOrder).not.toHaveBeenCalled();
        expect(loadOrder).toHaveBeenCalledTimes(1);
    });

    it('still re-reads the order when the caller cannot accept one', async () => {
        updateOrderItem.mockResolvedValue({ data: orderWith([line({ quantity: 3, subtotal: 30 })]) });
        await mount(orderWith([line()]), { acceptOrder: undefined });

        await tapAndWait();

        expect(loadOrder).toHaveBeenCalledTimes(1);
    });
});
