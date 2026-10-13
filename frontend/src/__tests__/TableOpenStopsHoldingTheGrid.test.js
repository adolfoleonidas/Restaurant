/**
 * TB-02: opening a table stops holding the grid.
 *
 * The waiter chose a table and found the menu unusable for as long as the sheet
 * took to open. `loading` used to cover the whole open, including the history
 * listing (`useTableSheet.js`): `getOrder` -> `listOrders({ limit: 50 })` ->
 * possibly a second `getOrder`, with `loading: false` only in the `finally`.
 * The listing is the history and the account cards: it is not what the composer
 * needs to work, so it must not gate it.
 *
 * What is required: `loading` covers only the account in view; the listing and
 * the account cards arrive on their own; and a listing that fails leaves the
 * sheet usable.
 */
import { act } from 'react';
import useTableSheet from '@/pages/salon/useTableSheet';
import { getOrder, listOrders } from '@/lib/api/orders';
import { renderHook, flush } from '@/test-utils/renderHook';

jest.mock('@/lib/api/orders', () => ({
    createOrder: jest.fn(),
    getOrder: jest.fn(),
    listOrders: jest.fn(),
    mergeOrder: jest.fn(),
    moveOrder: jest.fn(),
    moveOrderItem: jest.fn(),
    removeOrderItem: jest.fn(),
    saveDraftLines: jest.fn(),
    sendOrderToKitchen: jest.fn(),
    setOrderAlias: jest.fn(),
    splitOrder: jest.fn(),
    updateOrderItem: jest.fn(),
    voidOrderItem: jest.fn(),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('@/hooks/usePolling', () => ({ __esModule: true, default: () => ({ data: null }) }));

const table = (id, number, extra = {}) => ({
    id, number, name: `Mesa ${number}`, area: 'Salón', capacity: 4, status: 'disponible',
    branch_id: 'b1', active_order: null, active_attention_id: null, group: null, ...extra,
});
const item = (id, status, extra = {}) => ({
    id, product_id: `p-${id}`, product_name: `Plato ${id}`, status, quantity: 1, subtotal: 10, ...extra,
});
const order = (id, tableId, extra = {}) => ({
    id, order_number: 7, table_id: tableId, status: 'en_preparacion', total: 10, items: [], ...extra,
});

const refreshAll = jest.fn();
let mounted;

const mount = async (props = {}) => {
    mounted = await renderHook((p) => useTableSheet(p), {
        tables: [], orders: [], activeOrders: {}, canTake: true, refreshAll, ...props,
    });
    return mounted;
};

/** A listing that answers only when the test says so. */
const holdListing = () => {
    let release;
    listOrders.mockImplementation(() => new Promise((resolve) => {
        release = (data) => resolve({ data });
    }));
    return (data = []) => release(data);
};

beforeEach(() => {
    jest.useFakeTimers();
    refreshAll.mockReset();
    getOrder.mockReset().mockResolvedValue({ data: order('o1', 't1') });
    listOrders.mockReset().mockResolvedValue({ data: [] });
});

afterEach(async () => {
    if (mounted) await mounted.unmount();
    mounted = null;
    jest.useRealTimers();
});

describe('TB-02: the history listing does not hold the grid', () => {
    test('the sheet stops loading as soon as the account in view is known', async () => {
        const busy = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1', status: 'en_preparacion' } });
        const current = order('o1', 't1', { items: [item('a', 'borrador')] });
        getOrder.mockResolvedValue({ data: current });
        const release = holdListing();
        const view = await mount();

        // Not awaited: opening the table is still waiting for the listing.
        await act(async () => { void view.result.current.openSheet(busy); });

        expect(listOrders).toHaveBeenCalledWith({ table_id: 't1', limit: 50 });
        expect(view.result.current.openTable.loading).toBe(false);
        expect(view.result.current.openTable.order).toEqual(current);
        expect(view.result.current.openTable.history).toBeNull();
        // The listing still gates what genuinely needs it: knowing whether the
        // table already has an account before opening an independent one.
        expect(view.result.current.openTable.accountsLoading).toBe(true);

        await act(async () => { release([]); await Promise.resolve(); });
        await flush();
        expect(view.result.current.openTable.accountsLoading).toBe(false);
    });

    test('a listing that never answers stops gating the accounts too, and the sheet stays open', async () => {
        const busy = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1', status: 'en_preparacion' } });
        const current = order('o1', 't1', { items: [item('a', 'borrador')] });
        getOrder.mockResolvedValue({ data: current });
        listOrders.mockRejectedValue(new Error('sin red'));
        const view = await mount();

        await act(async () => { await view.result.current.openSheet(busy); });
        await flush();

        expect(view.result.current.openTable.loading).toBe(false);
        expect(view.result.current.openTable.accountsLoading).toBe(false);
        expect(view.result.current.openTable.order).toEqual(current);
    });

    test('a resumed draft opens the menu without waiting for the listing', async () => {
        const busy = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1', status: 'nuevo' } });
        getOrder.mockResolvedValue({ data: order('o1', 't1', { status: 'nuevo', items: [item('a', 'borrador')] }) });
        const release = holdListing();
        const view = await mount();

        await act(async () => { void view.result.current.openSheet(busy); });

        expect(view.result.current.composerOpen).toBe(true);
        expect(view.result.current.openTable.loading).toBe(false);

        await act(async () => { release([]); await Promise.resolve(); });
        await flush();
    });

    test('the account cards and the history still arrive when the listing answers', async () => {
        const busy = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1', status: 'en_preparacion' } });
        const current = order('o1', 't1', { items: [item('a', 'borrador')] });
        const other = order('o2', 't1', { items: [item('b', 'pendiente')] });
        const closed = order('o9', 't1', { status: 'pagado' });
        getOrder.mockResolvedValue({ data: current });
        const release = holdListing();
        const view = await mount();

        await act(async () => { void view.result.current.openSheet(busy); });
        expect(view.result.current.openTable.accounts).toEqual([]);

        await act(async () => { release([current, other, closed]); await Promise.resolve(); });
        await flush();

        expect(view.result.current.openTable.accounts).toEqual([current, other]);
        expect(view.result.current.openTable.history).toEqual([closed]);
        expect(view.result.current.openTable.loading).toBe(false);
    });

    test('a listing that fails leaves the sheet open and usable', async () => {
        const busy = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1', status: 'en_preparacion' } });
        const current = order('o1', 't1', { items: [item('a', 'borrador')] });
        getOrder.mockResolvedValue({ data: current });
        listOrders.mockRejectedValue(new Error('sin red'));
        const view = await mount();

        await act(async () => { await view.result.current.openSheet(busy); });
        await flush();

        expect(view.result.current.openTable.loading).toBe(false);
        expect(view.result.current.openTable.order).toEqual(current);
        expect(view.result.current.openTable.accountId).toBe('o1');
    });
});
