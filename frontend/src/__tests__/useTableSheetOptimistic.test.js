/**
 * UX-14: composer taps are optimistic and synced through a serial queue.
 * A tiny fake server holds the order; every write waits until the test
 * releases it, so each scenario controls exactly what is in flight.
 */
import { act } from 'react';
import { toast } from 'sonner';
import useTableSheet from '@/pages/salon/useTableSheet';
import {
    addOrderItems, createOrder, getOrder, listOrders, removeOrderItem, sendOrderToKitchen, updateOrderItem,
} from '@/lib/api/orders';
import { renderHook } from '@/test-utils/renderHook';

jest.mock('@/lib/api/orders', () => ({
    addOrderItems: jest.fn(),
    createOrder: jest.fn(),
    getOrder: jest.fn(),
    listOrders: jest.fn(),
    mergeOrder: jest.fn(),
    moveOrder: jest.fn(),
    moveOrderItem: jest.fn(),
    removeOrderItem: jest.fn(),
    sendOrderToKitchen: jest.fn(),
    setOrderAlias: jest.fn(),
    splitOrder: jest.fn(),
    updateOrderItem: jest.fn(),
    voidOrderItem: jest.fn(),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('@/hooks/usePolling', () => ({ __esModule: true, default: () => ({ data: null }) }));

const sopa = { id: 'p-a', name: 'Sopa', price: 10 };
const lomo = { id: 'p-b', name: 'Lomo', price: 30 };

let server;
let held;
let mounted;
const refreshAll = jest.fn();

const snapshot = () => ({
    id: server.id,
    order_number: 7,
    table_id: 't1',
    status: server.status,
    total: server.lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0),
    items: server.lines.map((l) => ({ ...l, subtotal: l.quantity * l.unit_price })),
});

/** A write that waits for `releaseNext()` and then changes the fake server. */
const hold = (apply) => new Promise((resolve, reject) => {
    held.push({ resolve: () => { apply(); resolve({ data: {} }); }, reject });
});
const releaseNext = async () => {
    await act(async () => { held.shift().resolve(); });
};
const failNext = async (error) => {
    await act(async () => { held.shift().reject(error); });
};
const settleAll = async () => {
    // Releases whatever is in flight until the queue has nothing left.
    for (let i = 0; i < 20; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        if (!held.length) break;
        // eslint-disable-next-line no-await-in-loop
        await releaseNext();
    }
};

const table = (extra = {}) => ({
    id: 't1', number: 1, name: 'Mesa 1', area: 'Salón', capacity: 4, status: 'ocupada', branch_id: 'b1',
    active_order: { id: 'o1', status: 'nuevo' }, active_attention_id: null, group: null, ...extra,
});

const quantityOf = (view, productId) => (view.result.current.sheetOrder?.items || [])
    .filter((i) => i.product_id === productId)
    .reduce((sum, i) => sum + i.quantity, 0);

const openTable = async (lines = [{ id: 'a', product_id: 'p-a', product_name: 'Sopa', quantity: 2, unit_price: 10, status: 'borrador', notes: null }]) => {
    server = { id: 'o1', status: 'nuevo', lines };
    const t = table();
    const view = await renderHook((p) => useTableSheet(p), {
        tables: [t], orders: [], activeOrders: {}, canTake: true, refreshAll,
    });
    mounted = view;
    await act(async () => { await view.result.current.openSheet(t); });
    return view;
};

beforeEach(() => {
    held = [];
    refreshAll.mockReset();
    getOrder.mockReset().mockImplementation(async () => ({ data: snapshot() }));
    listOrders.mockReset().mockResolvedValue({ data: [] });
    createOrder.mockReset();
    addOrderItems.mockReset();
    removeOrderItem.mockReset();
    updateOrderItem.mockReset();
    sendOrderToKitchen.mockReset().mockResolvedValue({ data: { id: 'o1', status: 'pendiente' } });
    Object.values(toast).forEach((fn) => fn.mockReset());
    updateOrderItem.mockImplementation((oid, id, body) => hold(() => {
        server.lines.find((l) => l.id === id).quantity = body.quantity;
    }));
    removeOrderItem.mockImplementation((oid, id) => hold(() => {
        server.lines = server.lines.filter((l) => l.id !== id);
    }));
    addOrderItems.mockImplementation((oid, items) => hold(() => {
        items.forEach((it) => server.lines.push({
            id: `l${server.lines.length + 1}`, product_id: it.product_id, product_name: it.product_id, quantity: it.quantity, unit_price: 10, status: 'borrador', notes: null,
        }));
    }));
    window.confirm = jest.fn(() => true);
});

afterEach(async () => {
    if (mounted) await mounted.unmount();
    mounted = null;
});

describe('UX-14 optimistic composer taps', () => {
    test('two quick + taps show 4 at once and end with 4 on the server, one request at a time', async () => {
        const view = await openTable();
        expect(quantityOf(view, 'p-a')).toBe(2);

        await act(async () => { void view.result.current.addProductToAccount(sopa); });
        expect(quantityOf(view, 'p-a')).toBe(3);
        expect(updateOrderItem).toHaveBeenCalledTimes(1);
        expect(updateOrderItem).toHaveBeenLastCalledWith('o1', 'a', { quantity: 3 });

        // Second tap while the first request is still in flight.
        await act(async () => { void view.result.current.addProductToAccount(sopa); });
        expect(quantityOf(view, 'p-a')).toBe(4);
        expect(view.result.current.sheetOrder.total).toBe(40);
        expect(updateOrderItem).toHaveBeenCalledTimes(1);
        expect(view.result.current.savingItem).toBe(false);

        await releaseNext();
        // The follow-up carries the net quantity, and the screen never dips back.
        expect(quantityOf(view, 'p-a')).toBe(4);
        expect(updateOrderItem).toHaveBeenCalledTimes(2);
        expect(updateOrderItem).toHaveBeenLastCalledWith('o1', 'a', { quantity: 4 });
        await releaseNext();
        await settleAll();
        expect(server.lines[0].quantity).toBe(4);
        expect(quantityOf(view, 'p-a')).toBe(4);
        expect(refreshAll).toHaveBeenCalled();
    });

    test('five taps in a row end with the five units on the server', async () => {
        const view = await openTable();
        for (let i = 0; i < 5; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await act(async () => { void view.result.current.addProductToAccount(sopa); });
        }
        expect(quantityOf(view, 'p-a')).toBe(7);
        await settleAll();
        expect(server.lines).toHaveLength(1);
        expect(server.lines[0].quantity).toBe(7);
    });

    test('a + and a - in the same tick net out and send nothing', async () => {
        const view = await openTable();
        await act(async () => {
            void view.result.current.addProductToAccount(sopa);
            void view.result.current.removeProductFromAccount(sopa, { id: 'a' });
        });
        expect(quantityOf(view, 'p-a')).toBe(2);
        await settleAll();
        expect(updateOrderItem).not.toHaveBeenCalled();
        expect(removeOrderItem).not.toHaveBeenCalled();
    });

    test('- at one unit removes the draft line and the quantity never goes below zero', async () => {
        const view = await openTable([{ id: 'a', product_id: 'p-a', product_name: 'Sopa', quantity: 1, unit_price: 10, status: 'borrador', notes: null }]);
        await act(async () => { void view.result.current.removeProductFromAccount(sopa, { id: 'a' }); });
        expect(quantityOf(view, 'p-a')).toBe(0);
        // A second - on a product that is already at zero does nothing.
        await act(async () => { void view.result.current.removeProductFromAccount(sopa, { id: 'a' }); });
        expect(quantityOf(view, 'p-a')).toBe(0);
        await settleAll();
        expect(removeOrderItem).toHaveBeenCalledTimes(1);
        expect(removeOrderItem).toHaveBeenCalledWith('o1', 'a');
        expect(server.lines).toHaveLength(0);
    });

    test('sent lines are not touched by -', async () => {
        const view = await openTable([{ id: 's', product_id: 'p-a', product_name: 'Sopa', quantity: 2, unit_price: 10, status: 'pendiente', notes: null }]);
        await act(async () => { void view.result.current.removeProductFromAccount(sopa, null); });
        await act(async () => { void view.result.current.removeProductFromAccount(sopa, { id: 's' }); });
        expect(quantityOf(view, 'p-a')).toBe(2);
        expect(updateOrderItem).not.toHaveBeenCalled();
        expect(removeOrderItem).not.toHaveBeenCalled();
    });

    test('the first tap on a free table creates the account once; later taps wait for the created line', async () => {
        server = { id: null, status: 'nuevo', lines: [] };
        const free = table({ active_order: null, status: 'disponible' });
        const view = await renderHook((p) => useTableSheet(p), {
            tables: [free], orders: [], activeOrders: {}, canTake: true, refreshAll,
        });
        mounted = view;
        await act(async () => { await view.result.current.openSheet(free); });
        createOrder.mockImplementation(() => new Promise((resolve) => {
            held.push({ resolve: () => { server.id = 'o5'; resolve({ data: { id: 'o5', status: 'nuevo', table_id: 't1', items: [], total: 0 } }); } });
        }));

        await act(async () => { void view.result.current.addProductToAccount(sopa); });
        // Optimistic: the order exists on screen with the unit before the server answers.
        expect(quantityOf(view, 'p-a')).toBe(1);
        expect(view.result.current.sheetOrder.total).toBe(10);
        await act(async () => { void view.result.current.addProductToAccount(sopa); });
        await act(async () => { void view.result.current.addProductToAccount(lomo); });
        expect(quantityOf(view, 'p-a')).toBe(2);
        expect(quantityOf(view, 'p-b')).toBe(1);
        expect(view.result.current.sheetOrder.total).toBe(50);
        expect(createOrder).toHaveBeenCalledTimes(1);

        await settleAll();
        expect(createOrder).toHaveBeenCalledTimes(1);
        // One line per product, with the net quantities.
        const byProduct = Object.fromEntries(server.lines.map((l) => [l.product_id, l.quantity]));
        expect(byProduct).toEqual({ 'p-a': 2, 'p-b': 1 });
        expect(server.lines).toHaveLength(2);
        expect(quantityOf(view, 'p-a')).toBe(2);
        expect(quantityOf(view, 'p-b')).toBe(1);
    });

    test('a failed request rolls the line back, toasts once, and keeps the taps usable', async () => {
        const view = await openTable();
        await act(async () => { void view.result.current.addProductToAccount(sopa); });
        await act(async () => { void view.result.current.addProductToAccount(sopa); });
        expect(quantityOf(view, 'p-a')).toBe(4);

        await failNext({ response: { data: { detail: 'Pedido cerrado' } } });
        await settleAll();
        expect(quantityOf(view, 'p-a')).toBe(2);
        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(toast.error).toHaveBeenCalledWith('Pedido cerrado');

        // Still usable afterwards.
        await act(async () => { void view.result.current.addProductToAccount(sopa); });
        await settleAll();
        expect(server.lines[0].quantity).toBe(3);
    });

    test('a failure on one line does not lose the taps of another line', async () => {
        const view = await openTable([
            { id: 'a', product_id: 'p-a', product_name: 'Sopa', quantity: 1, unit_price: 10, status: 'borrador', notes: null },
            { id: 'b', product_id: 'p-b', product_name: 'Lomo', quantity: 1, unit_price: 30, status: 'borrador', notes: null },
        ]);
        await act(async () => {
            void view.result.current.addProductToAccount(sopa);
            void view.result.current.addProductToAccount(lomo);
        });
        await failNext(new Error('network'));
        await settleAll();
        expect(quantityOf(view, 'p-a')).toBe(1);
        expect(quantityOf(view, 'p-b')).toBe(2);
        expect(server.lines.find((l) => l.id === 'b').quantity).toBe(2);
    });

    test('sending to the kitchen waits for the pending taps and sends the final state', async () => {
        const view = await openTable();
        await act(async () => { void view.result.current.addProductToAccount(sopa); });
        await act(async () => { void view.result.current.addProductToAccount(sopa); });
        let sent;
        await act(async () => { sent = view.result.current.sendCurrentToKitchen('o1'); });
        expect(sendOrderToKitchen).not.toHaveBeenCalled();
        expect(view.result.current.sendingToKitchen).toBe(true);

        await settleAll();
        await act(async () => { await sent; });
        expect(server.lines[0].quantity).toBe(4);
        expect(sendOrderToKitchen).toHaveBeenCalledTimes(1);
        expect(sendOrderToKitchen).toHaveBeenCalledWith('o1');
        // Nothing was sent before the queue was empty.
        expect(updateOrderItem.mock.invocationCallOrder.at(-1)).toBeLessThan(sendOrderToKitchen.mock.invocationCallOrder[0]);
        expect(view.result.current.sendingToKitchen).toBe(false);
    });

    test('the send is cancelled when a pending tap failed, so a stale draft never goes out', async () => {
        const view = await openTable();
        await act(async () => { void view.result.current.addProductToAccount(sopa); });
        let sent;
        await act(async () => { sent = view.result.current.sendCurrentToKitchen('o1'); });
        await failNext({ response: { data: { detail: 'Pedido cerrado' } } });
        await settleAll();
        let result;
        await act(async () => { result = await sent; });
        expect(result).toBe(false);
        expect(sendOrderToKitchen).not.toHaveBeenCalled();
        expect(view.result.current.sendingToKitchen).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('Pedido cerrado');
    });

    test('requesting the send before the account exists opens the review once the first tap is saved', async () => {
        server = { id: null, status: 'nuevo', lines: [] };
        const free = table({ active_order: null, status: 'disponible' });
        const view = await renderHook((p) => useTableSheet(p), {
            tables: [free], orders: [], activeOrders: {}, canTake: true, refreshAll,
        });
        mounted = view;
        await act(async () => { await view.result.current.openSheet(free); });
        createOrder.mockImplementation(() => new Promise((resolve) => {
            held.push({ resolve: () => { server.id = 'o5'; resolve({ data: { id: 'o5', status: 'nuevo', table_id: 't1', items: [], total: 0 } }); } });
        }));
        await act(async () => { void view.result.current.addProductToAccount(sopa); });
        await act(async () => { view.result.current.requestSend(); });
        expect(view.result.current.reviewOrderId).toBeNull();
        await settleAll();
        expect(view.result.current.reviewOrderId).toBe('o5');
    });

    test('leaving the composer flushes the pending taps before it asks about drafts', async () => {
        const view = await openTable();
        await act(async () => { void view.result.current.addProductToAccount(sopa); });
        let left;
        await act(async () => { left = view.result.current.leaveComposer(); });
        expect(window.confirm).not.toHaveBeenCalled();
        await settleAll();
        await act(async () => { await left; });
        // The tap reached the server before the waiter was asked about the draft.
        expect(updateOrderItem).toHaveBeenCalledWith('o1', 'a', { quantity: 3 });
        expect(window.confirm).toHaveBeenCalledTimes(1);
        expect(updateOrderItem.mock.invocationCallOrder[0]).toBeLessThan(window.confirm.mock.invocationCallOrder[0]);
        // Confirming discards the whole draft, including the line that was just saved.
        expect(server.lines).toHaveLength(0);
    });

    test('the ticket stepper goes through the same queue', async () => {
        const view = await openTable();
        const line = view.result.current.sheetOrder.items[0];
        await act(async () => { void view.result.current.changeItemQty(line, 1); });
        const next = view.result.current.sheetOrder.items[0];
        expect(next.quantity).toBe(3);
        await act(async () => { void view.result.current.changeItemQty(next, 1); });
        expect(view.result.current.sheetOrder.items[0].quantity).toBe(4);
        await settleAll();
        expect(server.lines[0].quantity).toBe(4);
        expect(updateOrderItem).toHaveBeenCalledTimes(2);
    });
});
