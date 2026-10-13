/**
 * UX-14 + BS-02: composer taps are optimistic and saved in batches.
 *
 * A tiny fake server holds the order and applies batches like the real
 * `PUT /orders/:id/draft-lines`. Every batch waits until the test releases it,
 * so each scenario controls exactly what is in flight. The pause that precedes a
 * batch runs on fake timers.
 */
import { act } from 'react';
import { toast } from 'sonner';
import useTableSheet from '@/pages/salon/useTableSheet';
import {
    createOrder, getOrder, listOrders, removeOrderItem, saveDraftLines, sendOrderToKitchen, setOrderAlias, updateOrderItem,
} from '@/lib/api/orders';
import { ORDER_SYNC_DELAY_MS } from '@/lib/lineSyncQueue';
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
    saveDraftLines: jest.fn(),
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

/** What the real endpoint does with a batch: upsert by client id (or line id), 0 removes, rejected lines are skipped. */
const applyLines = (lines) => lines.map((line) => {
    const id = line.client_line_id;
    if ((server.rejected || []).includes(id)) {
        return { client_line_id: id, result: 'rejected', code: 'not_draft', detail: 'Ese producto ya fue enviado a cocina.' };
    }
    const existing = server.lines.find((l) => l.client_line_id === id || l.id === id);
    if (existing) {
        if (line.quantity === 0) server.lines = server.lines.filter((l) => l !== existing);
        else existing.quantity = line.quantity;
        return { client_line_id: id, result: 'applied', line_id: existing.id };
    }
    if (line.quantity === 0) return { client_line_id: id, result: 'unchanged' };
    server.lines.push({
        id: `l${server.lines.length + 1}`, client_line_id: id, product_id: line.product_id, product_name: line.product_id, quantity: line.quantity, unit_price: 10, status: 'borrador', notes: null,
    });
    return { client_line_id: id, result: 'applied' };
});

/** A request that waits for `releaseNext()` and then answers like the endpoint: the whole order plus the report. */
const holdBatch = (lines) => new Promise((resolve, reject) => {
    held.push({
        resolve: () => { const line_results = applyLines(lines); resolve({ data: { ...snapshot(), line_results } }); },
        reject,
    });
});
const releaseNext = async () => {
    await act(async () => { held.shift().resolve(); });
};
const failNext = async (error) => {
    await act(async () => { held.shift().reject(error); });
};
const microtasks = () => act(async () => {
    for (let i = 0; i < 30; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
});
/** The waiter pauses: the window runs out. */
const pause = async (ms = ORDER_SYNC_DELAY_MS) => {
    await act(async () => { jest.advanceTimersByTime(ms); });
    await microtasks();
};
/** Lets every request in flight finish and every pause run out, until nothing is left. */
const settleAll = async () => {
    for (let i = 0; i < 20; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await pause();
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

const openFreeTable = async () => {
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
    return view;
};

const tap = (view, product = sopa) => act(async () => { void view.result.current.addProductToAccount(product); });

beforeEach(() => {
    jest.useFakeTimers();
    held = [];
    refreshAll.mockReset();
    getOrder.mockReset().mockImplementation(async () => ({ data: snapshot() }));
    listOrders.mockReset().mockResolvedValue({ data: [] });
    createOrder.mockReset();
    removeOrderItem.mockReset();
    updateOrderItem.mockReset();
    setOrderAlias.mockReset().mockResolvedValue({ data: {} });
    sendOrderToKitchen.mockReset().mockResolvedValue({ data: { id: 'o1', status: 'pendiente' } });
    Object.values(toast).forEach((fn) => fn.mockReset());
    saveDraftLines.mockReset().mockImplementation((oid, lines) => holdBatch(lines));
    window.confirm = jest.fn(() => true);
});

afterEach(async () => {
    if (mounted) await mounted.unmount();
    mounted = null;
    jest.useRealTimers();
});

describe('UX-14 optimistic composer taps', () => {
    test('two quick + taps show 4 at once and end with 4 on the server, in one request', async () => {
        const view = await openTable();
        expect(quantityOf(view, 'p-a')).toBe(2);

        await tap(view);
        expect(quantityOf(view, 'p-a')).toBe(3);
        // Nothing goes out while the waiter may still be tapping.
        expect(saveDraftLines).not.toHaveBeenCalled();

        await tap(view);
        expect(quantityOf(view, 'p-a')).toBe(4);
        expect(view.result.current.sheetOrder.total).toBe(40);
        expect(view.result.current.savingItem).toBe(false);

        await pause();
        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        expect(saveDraftLines).toHaveBeenLastCalledWith('o1', [{ client_line_id: 'a', quantity: 4 }]);

        await releaseNext();
        await settleAll();
        expect(server.lines[0].quantity).toBe(4);
        expect(quantityOf(view, 'p-a')).toBe(4);
        // The batch confirmed the line from its own answer: no floor refresh for a plain quantity change.
        expect(refreshAll).not.toHaveBeenCalled();
        expect(saveDraftLines).toHaveBeenCalledTimes(1);
    });

    test('taps made while a batch is in flight travel in the next one and the screen never dips back', async () => {
        const view = await openTable();
        await tap(view);
        await pause();
        expect(saveDraftLines).toHaveBeenLastCalledWith('o1', [{ client_line_id: 'a', quantity: 3 }]);

        await tap(view);
        await tap(view);
        expect(quantityOf(view, 'p-a')).toBe(5);
        await pause();
        // One batch at a time: the second waits for the first.
        expect(saveDraftLines).toHaveBeenCalledTimes(1);

        await releaseNext();
        expect(quantityOf(view, 'p-a')).toBe(5);
        await pause();
        expect(saveDraftLines).toHaveBeenCalledTimes(2);
        expect(saveDraftLines).toHaveBeenLastCalledWith('o1', [{ client_line_id: 'a', quantity: 5 }]);
        await releaseNext();
        await settleAll();
        expect(server.lines[0].quantity).toBe(5);
        expect(quantityOf(view, 'p-a')).toBe(5);
    });

    test('five taps in a row end with the five units on the server, in one request', async () => {
        const view = await openTable();
        for (let i = 0; i < 5; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await tap(view);
        }
        expect(quantityOf(view, 'p-a')).toBe(7);
        await settleAll();
        expect(saveDraftLines).toHaveBeenCalledTimes(1);
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
        expect(saveDraftLines).not.toHaveBeenCalled();
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
        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        expect(saveDraftLines).toHaveBeenCalledWith('o1', [{ client_line_id: 'a', quantity: 0 }]);
        expect(server.lines).toHaveLength(0);
    });

    test('sent lines are not touched by -', async () => {
        const view = await openTable([{ id: 's', product_id: 'p-a', product_name: 'Sopa', quantity: 2, unit_price: 10, status: 'pendiente', notes: null }]);
        await act(async () => { void view.result.current.removeProductFromAccount(sopa, null); });
        await act(async () => { void view.result.current.removeProductFromAccount(sopa, { id: 's' }); });
        expect(quantityOf(view, 'p-a')).toBe(2);
        await settleAll();
        expect(saveDraftLines).not.toHaveBeenCalled();
    });

    test('several products and several lines share one request', async () => {
        const view = await openTable([
            { id: 'a', product_id: 'p-a', product_name: 'Sopa', quantity: 1, unit_price: 10, status: 'borrador', notes: null },
            { id: 'b', product_id: 'p-b', product_name: 'Lomo', quantity: 1, unit_price: 10, status: 'borrador', notes: null },
        ]);
        await tap(view, sopa);
        await tap(view, lomo);
        await tap(view, lomo);
        await settleAll();

        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        expect(saveDraftLines.mock.calls[0][1]).toEqual([
            { client_line_id: 'a', quantity: 2 },
            { client_line_id: 'b', quantity: 3 },
        ]);
        expect(quantityOf(view, 'p-a')).toBe(2);
        expect(quantityOf(view, 'p-b')).toBe(3);
    });

    test('the first tap on a free table creates the account at once, and the lines wait for the batch', async () => {
        const view = await openFreeTable();

        await tap(view);
        // The account is requested on the first tap, without waiting for the pause.
        expect(createOrder).toHaveBeenCalledTimes(1);
        // Optimistic: the order exists on screen with the unit before the server answers.
        expect(quantityOf(view, 'p-a')).toBe(1);
        expect(view.result.current.sheetOrder.total).toBe(10);
        await tap(view);
        await tap(view, lomo);
        expect(quantityOf(view, 'p-a')).toBe(2);
        expect(quantityOf(view, 'p-b')).toBe(1);
        expect(view.result.current.sheetOrder.total).toBe(50);
        expect(createOrder).toHaveBeenCalledTimes(1);
        expect(saveDraftLines).not.toHaveBeenCalled();

        await releaseNext();
        expect(saveDraftLines).not.toHaveBeenCalled();
        await settleAll();
        expect(createOrder).toHaveBeenCalledTimes(1);
        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        expect(saveDraftLines.mock.calls[0][0]).toBe('o5');
        // One line per product, with the net quantities.
        const byProduct = Object.fromEntries(server.lines.map((l) => [l.product_id, l.quantity]));
        expect(byProduct).toEqual({ 'p-a': 2, 'p-b': 1 });
        expect(server.lines).toHaveLength(2);
        expect(quantityOf(view, 'p-a')).toBe(2);
        expect(quantityOf(view, 'p-b')).toBe(1);
        // The floor learns about the new account once the lines are saved.
        expect(refreshAll).toHaveBeenCalledTimes(1);
    });

    test('a refused batch rolls the lines back, toasts once, and keeps the taps usable', async () => {
        const view = await openTable();
        await tap(view);
        await tap(view);
        expect(quantityOf(view, 'p-a')).toBe(4);
        await pause();

        await failNext({ response: { status: 400, data: { detail: 'Pedido cerrado' } } });
        await settleAll();
        expect(quantityOf(view, 'p-a')).toBe(2);
        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(toast.error).toHaveBeenCalledWith('Pedido cerrado');

        // Still usable afterwards.
        await tap(view);
        await settleAll();
        expect(server.lines[0].quantity).toBe(3);
    });

    test('a rejected line goes back to its confirmed quantity while the other lines are saved', async () => {
        const view = await openTable([
            { id: 'a', product_id: 'p-a', product_name: 'Sopa', quantity: 1, unit_price: 10, status: 'borrador', notes: null },
            { id: 'b', product_id: 'p-b', product_name: 'Lomo', quantity: 1, unit_price: 30, status: 'borrador', notes: null },
        ]);
        server.rejected = ['a'];
        await tap(view, sopa);
        await tap(view, lomo);
        await settleAll();

        expect(quantityOf(view, 'p-a')).toBe(1);
        expect(quantityOf(view, 'p-b')).toBe(2);
        expect(server.lines.find((l) => l.id === 'b').quantity).toBe(2);
        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(toast.error).toHaveBeenCalledWith('Ese producto ya fue enviado a cocina.');
    });

    test('when the connection fails the taps stay on screen and are saved by themselves later', async () => {
        const view = await openTable();
        await tap(view);
        await tap(view);
        await pause();
        await failNext(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', request: {} }));
        await microtasks();

        // Nothing is rolled back: the waiter's numbers are still there, and the screen says so once.
        expect(quantityOf(view, 'p-a')).toBe(4);
        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(toast.error.mock.calls[0][0]).toMatch(/Sin conexión/);
        expect(view.result.current.saveState).toBe('unsaved');

        // The connection comes back: the outbox sends the same batch again.
        await act(async () => { window.dispatchEvent(new Event('online')); });
        await microtasks();
        expect(saveDraftLines).toHaveBeenCalledTimes(2);
        expect(saveDraftLines.mock.calls[1][1]).toEqual([{ client_line_id: 'a', quantity: 4 }]);
        await releaseNext();
        await settleAll();
        expect(server.lines[0].quantity).toBe(4);
        expect(view.result.current.saveState).toBe('idle');
    });

    test('sending to the kitchen saves the waiting taps at once and sends the final state', async () => {
        const view = await openTable();
        await tap(view);
        await tap(view);
        let sent;
        await act(async () => { sent = view.result.current.sendCurrentToKitchen('o1'); });
        // No pause needed: the send is a moment that cannot wait.
        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        expect(sendOrderToKitchen).not.toHaveBeenCalled();
        expect(view.result.current.sendingToKitchen).toBe(true);

        await settleAll();
        await act(async () => { await sent; });
        expect(server.lines[0].quantity).toBe(4);
        expect(sendOrderToKitchen).toHaveBeenCalledTimes(1);
        expect(sendOrderToKitchen).toHaveBeenCalledWith('o1');
        // Nothing was sent before the outbox was empty.
        expect(saveDraftLines.mock.invocationCallOrder.at(-1)).toBeLessThan(sendOrderToKitchen.mock.invocationCallOrder[0]);
        expect(view.result.current.sendingToKitchen).toBe(false);
    });

    test('the send is cancelled when a pending tap was rejected, so a stale draft never goes out', async () => {
        const view = await openTable();
        await tap(view);
        let sent;
        await act(async () => { sent = view.result.current.sendCurrentToKitchen('o1'); });
        await failNext({ response: { status: 400, data: { detail: 'Pedido cerrado' } } });
        await settleAll();
        let result;
        await act(async () => { result = await sent; });
        expect(result).toBe(false);
        expect(sendOrderToKitchen).not.toHaveBeenCalled();
        expect(view.result.current.sendingToKitchen).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('Pedido cerrado');
    });

    test('the send is cancelled when the taps could not be saved because the connection is down', async () => {
        const view = await openTable();
        await tap(view);
        let sent;
        await act(async () => { sent = view.result.current.sendCurrentToKitchen('o1'); });
        await failNext(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', request: {} }));
        await microtasks();
        let result;
        await act(async () => { result = await sent; });

        expect(result).toBe(false);
        expect(sendOrderToKitchen).not.toHaveBeenCalled();
        // The waiter's tap is still there, waiting to be saved.
        expect(quantityOf(view, 'p-a')).toBe(3);
        expect(view.result.current.saveState).toBe('unsaved');
    });

    test('requesting the send before the account exists opens the review as soon as the account does', async () => {
        const view = await openFreeTable();
        await tap(view);
        await act(async () => { view.result.current.requestSend(); });
        expect(view.result.current.reviewOrderId).toBeNull();

        await releaseNext();
        await microtasks();
        // The account exists; the lines can still be waiting for their batch.
        expect(view.result.current.reviewOrderId).toBe('o5');
        expect(view.result.current.reviewItems.map((item) => item.quantity)).toEqual([1]);
    });

    test('leaving the composer saves the waiting taps at once, before it asks about drafts', async () => {
        const view = await openTable();
        await tap(view);
        let left;
        await act(async () => { left = view.result.current.leaveComposer(); });
        expect(window.confirm).not.toHaveBeenCalled();
        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        await settleAll();
        await act(async () => { await left; });
        // The tap reached the server before the waiter was asked about the draft.
        expect(saveDraftLines).toHaveBeenCalledWith('o1', [{ client_line_id: 'a', quantity: 3 }]);
        expect(window.confirm).toHaveBeenCalledTimes(1);
        expect(saveDraftLines.mock.invocationCallOrder[0]).toBeLessThan(window.confirm.mock.invocationCallOrder[0]);
        // Confirming discards the whole draft, including the line that was just saved.
        expect(removeOrderItem).toHaveBeenCalledWith('o1', 'a');
    });

    test('leaving the composer with taps that could not be saved stays and says so', async () => {
        const view = await openTable();
        await tap(view);
        let left;
        await act(async () => { left = view.result.current.leaveComposer(); });
        await failNext(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', request: {} }));
        await microtasks();
        await act(async () => { await left; });

        expect(window.confirm).not.toHaveBeenCalled();
        expect(view.result.current.openTable).not.toBeNull();
        expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/sin guardar/i), expect.anything());
        expect(quantityOf(view, 'p-a')).toBe(3);
    });

    test('the ticket stepper goes through the same outbox', async () => {
        const view = await openTable();
        const line = view.result.current.sheetOrder.items[0];
        await act(async () => { void view.result.current.changeItemQty(line, 1); });
        const next = view.result.current.sheetOrder.items[0];
        expect(next.quantity).toBe(3);
        await act(async () => { void view.result.current.changeItemQty(next, 1); });
        expect(view.result.current.sheetOrder.items[0].quantity).toBe(4);
        await settleAll();
        expect(server.lines[0].quantity).toBe(4);
        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        expect(updateOrderItem).not.toHaveBeenCalled();
    });
});

describe('BS-02 moments that save the waiting taps first', () => {
    test('switching to another account saves the taps of the one in view before loading the other', async () => {
        const other = {
            id: 'o2', order_number: 8, table_id: 't1', status: 'nuevo', total: 0, items: [],
        };
        const view = await openTable();
        getOrder.mockImplementation(async (id) => ({ data: id === 'o2' ? other : snapshot() }));
        await tap(view);

        let selected;
        await act(async () => { selected = view.result.current.selectAccount('o2'); });
        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        const loadsBefore = getOrder.mock.calls.filter(([id]) => id === 'o2').length;
        expect(loadsBefore).toBe(0);
        await settleAll();
        await act(async () => { await selected; });

        expect(server.lines[0].quantity).toBe(3);
        expect(getOrder).toHaveBeenCalledWith('o2');
        expect(view.result.current.openTable.accountId).toBe('o2');
        expect(saveDraftLines.mock.invocationCallOrder[0]).toBeLessThan(
            getOrder.mock.invocationCallOrder[getOrder.mock.calls.findIndex(([id]) => id === 'o2')]
        );
    });

    test('renaming an account saves its waiting taps before the alias goes out', async () => {
        const view = await openTable();
        await tap(view);
        let renamed;
        await act(async () => { renamed = view.result.current.renamePerson('o1', 'Ana'); });
        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        expect(setOrderAlias).not.toHaveBeenCalled();
        await settleAll();
        await act(async () => { await renamed; });

        expect(setOrderAlias).toHaveBeenCalledWith('o1', { alias: 'Ana', shared: false });
        expect(saveDraftLines.mock.invocationCallOrder[0]).toBeLessThan(setOrderAlias.mock.invocationCallOrder[0]);
    });

    test('a rename that cannot save the waiting taps first does not go out', async () => {
        const view = await openTable();
        await tap(view);
        let renamed;
        await act(async () => { renamed = view.result.current.renamePerson('o1', 'Ana'); });
        await failNext(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', request: {} }));
        await microtasks();
        await act(async () => { await renamed; });

        expect(setOrderAlias).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/sin guardar/i), expect.anything());
    });

    test('clearing the draft saves the waiting taps first and then removes what is on the server', async () => {
        const view = await openTable();
        await tap(view);
        let cleared;
        await act(async () => { cleared = view.result.current.clearDraft(); });
        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        expect(window.confirm).not.toHaveBeenCalled();
        await settleAll();
        await act(async () => { await cleared; });

        expect(window.confirm).toHaveBeenCalledTimes(1);
        expect(removeOrderItem).toHaveBeenCalledWith('o1', 'a');
    });

    test('starting a new account saves the taps of the one in view first', async () => {
        const view = await openTable();
        await tap(view);
        let started;
        await act(async () => { started = view.result.current.startNewAccount(); });
        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        expect(view.result.current.openTable.order).not.toBeNull();
        await settleAll();
        await act(async () => { await started; });

        expect(server.lines[0].quantity).toBe(3);
        expect(view.result.current.openTable.order).toBeNull();
        expect(view.result.current.composerOpen).toBe(true);
    });

    test('the app going to the background saves what is waiting', async () => {
        const view = await openTable();
        await tap(view);
        expect(saveDraftLines).not.toHaveBeenCalled();
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
        delete document.visibilityState;

        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        await settleAll();
        expect(server.lines[0].quantity).toBe(3);
    });
});
