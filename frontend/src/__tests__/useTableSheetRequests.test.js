/**
 * CP-02: how many requests one composer tap costs on the table sheet.
 *
 * Before: PATCH/POST + GET of the order + `refreshAll()` (tables + orders).
 * After: the write response confirms the line, and the floor is refreshed only
 * when the tap created the account (the table changes state then).
 */
import { act } from 'react';
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

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
    refreshAll.mockReset();
    getOrder.mockReset().mockImplementation(async () => ({ data: snapshot() }));
    listOrders.mockReset().mockResolvedValue({ data: [] });
    createOrder.mockReset();
    sendOrderToKitchen.mockReset();
    addOrderItems.mockReset().mockImplementation(async (oid, items) => {
        items.forEach((it) => server.lines.push({
            id: `l${server.lines.length + 1}`, product_id: it.product_id, product_name: it.product_id, quantity: it.quantity, unit_price: 10, status: 'borrador', notes: null,
        }));
        return { data: snapshot() };
    });
    updateOrderItem.mockReset().mockImplementation(async (oid, id, body) => {
        server.lines.find((l) => l.id === id).quantity = body.quantity;
        return { data: snapshot() };
    });
    removeOrderItem.mockReset().mockImplementation(async (oid, id) => {
        server.lines = server.lines.filter((l) => l.id !== id);
        return { data: snapshot() };
    });
});

afterEach(async () => {
    if (mounted) await mounted.unmount();
    mounted = null;
});

const existingLine = { id: 'a', product_id: 'p-a', product_name: 'Sopa', quantity: 2, unit_price: 10, status: 'borrador', notes: null };

describe('requests per composer tap (CP-02)', () => {
    it('a tap on an existing line costs one request: the PATCH, no GET and no floor refresh', async () => {
        server = { id: 'o1', status: 'nuevo', lines: [{ ...existingLine }] };
        const view = await mountSheet(table());
        const getsAfterOpen = getOrder.mock.calls.length;

        await act(async () => { await view.result.current.addProductToAccount(sopa); });
        await settle();

        expect(updateOrderItem).toHaveBeenCalledTimes(1);
        expect(getOrder.mock.calls.length).toBe(getsAfterOpen);
        expect(refreshAll).not.toHaveBeenCalled();
        expect(quantityOf(view, 'p-a')).toBe(3);
        expect(view.result.current.sheetOrder.total).toBe(30);
    });

    it('a burst of taps stays at one write per drain step and never re-reads the order', async () => {
        server = { id: 'o1', status: 'nuevo', lines: [{ ...existingLine }] };
        const view = await mountSheet(table());
        const getsAfterOpen = getOrder.mock.calls.length;

        await act(async () => {
            void view.result.current.addProductToAccount(sopa);
            void view.result.current.addProductToAccount(sopa);
            await view.result.current.addProductToAccount(sopa);
        });
        await settle();

        expect(updateOrderItem).toHaveBeenCalledTimes(1);
        expect(updateOrderItem).toHaveBeenLastCalledWith('o1', 'a', { quantity: 5 });
        expect(getOrder.mock.calls.length).toBe(getsAfterOpen);
        expect(refreshAll).not.toHaveBeenCalled();
        expect(quantityOf(view, 'p-a')).toBe(5);
    });

    it('removing the last unit is one DELETE and no GET', async () => {
        server = { id: 'o1', status: 'nuevo', lines: [{ ...existingLine, quantity: 1 }] };
        const view = await mountSheet(table());
        const getsAfterOpen = getOrder.mock.calls.length;

        await act(async () => { await view.result.current.removeProductFromAccount(sopa, { id: 'a' }); });
        await settle();

        expect(removeOrderItem).toHaveBeenCalledTimes(1);
        expect(getOrder.mock.calls.length).toBe(getsAfterOpen);
        expect(refreshAll).not.toHaveBeenCalled();
        expect(quantityOf(view, 'p-a')).toBe(0);
    });

    it('the first product on a free table refreshes the floor once, because the table changes state', async () => {
        server = { id: null, status: 'nuevo', lines: [] };
        const free = table({ active_order: null, status: 'disponible' });
        const view = await mountSheet(free);
        createOrder.mockImplementation(async () => {
            server.id = 'o5';
            return { data: { id: 'o5', status: 'nuevo', table_id: 't1', items: [], total: 0 } };
        });
        const getsAfterOpen = getOrder.mock.calls.length;

        await act(async () => { await view.result.current.addProductToAccount(sopa); });
        await settle();

        expect(createOrder).toHaveBeenCalledTimes(1);
        expect(addOrderItems).toHaveBeenCalledTimes(1);
        expect(getOrder.mock.calls.length).toBe(getsAfterOpen);
        expect(refreshAll).toHaveBeenCalledTimes(1);
        expect(quantityOf(view, 'p-a')).toBe(1);

        // Later taps on that account are plain line updates again.
        refreshAll.mockClear();
        await act(async () => { await view.result.current.addProductToAccount(sopa); });
        await settle();
        expect(refreshAll).not.toHaveBeenCalled();
        expect(quantityOf(view, 'p-a')).toBe(2);
    });

    it('keeps a single GET of the order, and no floor refresh, when the response cannot confirm', async () => {
        server = { id: 'o1', status: 'nuevo', lines: [{ ...existingLine }] };
        const view = await mountSheet(table());
        updateOrderItem.mockImplementation(async (oid, id, body) => {
            server.lines.find((l) => l.id === id).quantity = body.quantity;
            return { data: {} };
        });
        const getsAfterOpen = getOrder.mock.calls.length;

        await act(async () => { await view.result.current.addProductToAccount(sopa); });
        await settle();

        expect(getOrder.mock.calls.length).toBe(getsAfterOpen + 1);
        expect(refreshAll).not.toHaveBeenCalled();
        expect(quantityOf(view, 'p-a')).toBe(3);
    });
});
