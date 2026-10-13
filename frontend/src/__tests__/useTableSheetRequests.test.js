/**
 * CP-02 + BS-02: how many requests composer taps cost on the table sheet.
 *
 * Before CP-02: PATCH/POST + GET of the order + `refreshAll()` (tables + orders) per tap.
 * CP-02: the write response confirms the line, and the floor is refreshed only
 * when the tap created the account (the table changes state then).
 * BS-02: taps are not written one by one: everything the waiter tapped goes out in
 * ONE batch when they pause, however many taps and products that is.
 */
import { act } from 'react';
import useTableSheet from '@/pages/salon/useTableSheet';
import {
    createOrder, getOrder, listOrders, removeOrderItem, saveDraftLines, sendOrderToKitchen, updateOrderItem,
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
const refreshAll = jest.fn();

let server;
let mounted;

const snapshot = () => ({
    id: server.id,
    order_number: 7,
    table_id: 't1',
    status: server.status,
    total: server.lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0),
    items: server.lines.map((l) => ({ ...l, subtotal: l.quantity * l.unit_price })),
});

const table = (extra = {}) => ({
    id: 't1', number: 1, name: 'Mesa 1', area: 'Salón', capacity: 4, status: 'ocupada', branch_id: 'b1',
    active_order: { id: 'o1', status: 'nuevo' }, active_attention_id: null, group: null, ...extra,
});

const quantityOf = (view, productId) => (view.result.current.sheetOrder?.items || [])
    .filter((i) => i.product_id === productId)
    .reduce((sum, i) => sum + i.quantity, 0);

const mountSheet = async (t) => {
    const view = await renderHook((p) => useTableSheet(p), {
        tables: [t], orders: [], activeOrders: {}, canTake: true, refreshAll,
    });
    mounted = view;
    await act(async () => { await view.result.current.openSheet(t); });
    return view;
};

// The waiter pauses: the window runs out and the batch is answered.
const pause = async () => {
    await act(async () => { jest.advanceTimersByTime(ORDER_SYNC_DELAY_MS); });
    await act(async () => {
        for (let i = 0; i < 30; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await Promise.resolve();
        }
    });
};
const tap = (view, product = sopa) => act(async () => { await view.result.current.addProductToAccount(product); });

beforeEach(() => {
    jest.useFakeTimers();
    refreshAll.mockReset();
    getOrder.mockReset().mockImplementation(async () => ({ data: snapshot() }));
    listOrders.mockReset().mockResolvedValue({ data: [] });
    createOrder.mockReset();
    sendOrderToKitchen.mockReset();
    updateOrderItem.mockReset();
    removeOrderItem.mockReset();
    saveDraftLines.mockReset().mockImplementation(async (oid, lines) => {
        lines.forEach((line) => {
            const existing = server.lines.find((l) => l.client_line_id === line.client_line_id || l.id === line.client_line_id);
            if (existing && line.quantity === 0) server.lines = server.lines.filter((l) => l !== existing);
            else if (existing) existing.quantity = line.quantity;
            else if (line.quantity > 0) {
                server.lines.push({
                    id: `l${server.lines.length + 1}`, client_line_id: line.client_line_id, product_id: line.product_id, product_name: line.product_id, quantity: line.quantity, unit_price: 10, status: 'borrador', notes: null,
                });
            }
        });
        return { data: { ...snapshot(), line_results: lines.map((line) => ({ client_line_id: line.client_line_id, result: 'applied' })) } };
    });
});

afterEach(async () => {
    if (mounted) await mounted.unmount();
    mounted = null;
    jest.useRealTimers();
});

const existingLine = { id: 'a', product_id: 'p-a', product_name: 'Sopa', quantity: 2, unit_price: 10, status: 'borrador', notes: null };

describe('requests per composer tap (CP-02 + BS-02)', () => {
    it('a tap on an existing line costs one request after the pause: the batch, no GET and no floor refresh', async () => {
        server = { id: 'o1', status: 'nuevo', lines: [{ ...existingLine }] };
        const view = await mountSheet(table());
        const getsAfterOpen = getOrder.mock.calls.length;

        await tap(view);
        expect(saveDraftLines).not.toHaveBeenCalled();
        await pause();

        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        expect(updateOrderItem).not.toHaveBeenCalled();
        expect(getOrder.mock.calls.length).toBe(getsAfterOpen);
        expect(refreshAll).not.toHaveBeenCalled();
        expect(quantityOf(view, 'p-a')).toBe(3);
        expect(view.result.current.sheetOrder.total).toBe(30);
    });

    it('a burst of taps is one write however long it is, and never re-reads the order', async () => {
        server = { id: 'o1', status: 'nuevo', lines: [{ ...existingLine }] };
        const view = await mountSheet(table());
        const getsAfterOpen = getOrder.mock.calls.length;

        await act(async () => {
            void view.result.current.addProductToAccount(sopa);
            void view.result.current.addProductToAccount(sopa);
            await view.result.current.addProductToAccount(sopa);
        });
        await pause();

        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        expect(saveDraftLines).toHaveBeenLastCalledWith('o1', [{ client_line_id: 'a', quantity: 5 }]);
        expect(getOrder.mock.calls.length).toBe(getsAfterOpen);
        expect(refreshAll).not.toHaveBeenCalled();
        expect(quantityOf(view, 'p-a')).toBe(5);
    });

    it('twenty taps on five products, one of them new, are still one request', async () => {
        const lines = ['p-a', 'p-b', 'p-c', 'p-d'].map((id) => ({
            id: `l-${id}`, product_id: id, product_name: id, quantity: 1, unit_price: 10, status: 'borrador', notes: null,
        }));
        server = { id: 'o1', status: 'nuevo', lines };
        const view = await mountSheet(table());

        for (let i = 0; i < 20; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await tap(view, { id: ['p-a', 'p-b', 'p-c', 'p-d', 'p-e'][i % 5], name: 'x', price: 10 });
        }
        await pause();

        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        const sent = saveDraftLines.mock.calls[0][1];
        expect(sent).toHaveLength(5);
        expect(sent.map((line) => line.quantity)).toEqual([5, 5, 5, 5, 4]);
        expect(sent[4]).toMatchObject({ product_id: 'p-e' });
        expect(getOrder).toHaveBeenCalledTimes(1);
        expect(refreshAll).not.toHaveBeenCalled();
    });

    it('removing the last unit is one batch and no GET', async () => {
        server = { id: 'o1', status: 'nuevo', lines: [{ ...existingLine, quantity: 1 }] };
        const view = await mountSheet(table());
        const getsAfterOpen = getOrder.mock.calls.length;

        await act(async () => { await view.result.current.removeProductFromAccount(sopa, { id: 'a' }); });
        await pause();

        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        expect(saveDraftLines).toHaveBeenLastCalledWith('o1', [{ client_line_id: 'a', quantity: 0 }]);
        expect(removeOrderItem).not.toHaveBeenCalled();
        expect(getOrder.mock.calls.length).toBe(getsAfterOpen);
        expect(refreshAll).not.toHaveBeenCalled();
        expect(quantityOf(view, 'p-a')).toBe(0);
    });

    it('the first product on a free table creates the account at once and refreshes the floor once, after the batch', async () => {
        server = { id: null, status: 'nuevo', lines: [] };
        const free = table({ active_order: null, status: 'disponible' });
        const view = await mountSheet(free);
        createOrder.mockImplementation(async () => {
            server.id = 'o5';
            return { data: { id: 'o5', status: 'nuevo', table_id: 't1', items: [], total: 0 } };
        });
        const getsAfterOpen = getOrder.mock.calls.length;

        await tap(view);
        // The account is created on the tap, not after the pause.
        expect(createOrder).toHaveBeenCalledTimes(1);
        expect(saveDraftLines).not.toHaveBeenCalled();
        await pause();

        expect(createOrder).toHaveBeenCalledTimes(1);
        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        expect(getOrder.mock.calls.length).toBe(getsAfterOpen);
        expect(refreshAll).toHaveBeenCalledTimes(1);
        expect(quantityOf(view, 'p-a')).toBe(1);

        // Later taps on that account are plain line updates again.
        refreshAll.mockClear();
        await tap(view);
        await pause();
        expect(saveDraftLines).toHaveBeenCalledTimes(2);
        expect(refreshAll).not.toHaveBeenCalled();
        expect(quantityOf(view, 'p-a')).toBe(2);
    });

    it('keeps a single GET of the order, and no floor refresh, when the response cannot confirm', async () => {
        server = { id: 'o1', status: 'nuevo', lines: [{ ...existingLine }] };
        const view = await mountSheet(table());
        saveDraftLines.mockImplementation(async (oid, lines) => {
            server.lines.find((l) => l.id === lines[0].client_line_id).quantity = lines[0].quantity;
            return { data: {} };
        });
        const getsAfterOpen = getOrder.mock.calls.length;

        await tap(view);
        await pause();

        expect(getOrder.mock.calls.length).toBe(getsAfterOpen + 1);
        expect(refreshAll).not.toHaveBeenCalled();
        expect(quantityOf(view, 'p-a')).toBe(3);
    });
});
