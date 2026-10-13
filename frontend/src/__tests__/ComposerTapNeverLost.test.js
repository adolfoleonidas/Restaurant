/**
 * TB-01: a tap on the menu is never swallowed.
 *
 * The waiter reported tapping products right after choosing a table and getting
 * nothing back. Two things caused it, and both are pinned here:
 *
 * 1. The cards were disabled by state that has nothing to do with the product
 *    (`savingItem || sendingToKitchen || loading` reached the card as `busy`),
 *    and the card carries no disabled styling, so it looked tappable.
 * 2. The handler returned early on `loading` with no toast and no state change:
 *    the tap was simply gone.
 *
 * What is required instead: only a product that cannot be ordered disables its
 * card; a tap that arrives while the account in view is still being resolved is
 * held and applied as soon as it is known (so it is neither lost nor turned into
 * a second account); and a tap that is genuinely refused says so out loud.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import OrderComposer from '@/components/OrderComposer';
import useTableSheet from '@/pages/salon/useTableSheet';
import { createOrder, getOrder, listOrders, saveDraftLines, sendOrderToKitchen, setOrderAlias } from '@/lib/api/orders';
import { ORDER_SYNC_DELAY_MS } from '@/lib/lineSyncQueue';
import { renderHook } from '@/test-utils/renderHook';
import { toast } from 'sonner';

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
    setOrderNotes: jest.fn(),
    splitOrder: jest.fn(),
    updateOrderItem: jest.fn(),
    voidOrderItem: jest.fn(),
}));
jest.mock('@/lib/feedback', () => ({
    soundEnabled: () => false,
    setSoundEnabled: jest.fn(),
    tick: jest.fn(),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('@/hooks/usePolling', () => ({ __esModule: true, default: () => ({ data: null }) }));

global.IS_REACT_ACT_ENVIRONMENT = true;

const sopa = { id: 'p-a', name: 'Sopa', price: 10, is_available: true };
const refreshAll = jest.fn();

const table = (extra = {}) => ({
    id: 't1', number: 1, name: 'Mesa 1', area: 'Salón', capacity: 4, status: 'ocupada', branch_id: 'b1',
    active_order: { id: 'o1', status: 'nuevo' }, active_attention_id: null, group: null, ...extra,
});

const snapshot = (lines = []) => ({
    id: 'o1',
    order_number: 7,
    table_id: 't1',
    status: 'nuevo',
    total: lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0),
    items: lines.map((l) => ({ ...l, subtotal: l.quantity * l.unit_price })),
});

let server;
let mounted;

const quantityOf = (view, productId) => (view.result.current.sheetOrder?.items || [])
    .filter((i) => i.product_id === productId)
    .reduce((sum, i) => sum + i.quantity, 0);

const mountSheet = async (t) => {
    const view = await renderHook((p) => useTableSheet(p), {
        tables: [t], orders: [], activeOrders: {}, canTake: true, refreshAll,
    });
    mounted = view;
    return view;
};

/** Lets every pending microtask and state update settle. */
const settle = async () => {
    await act(async () => {
        for (let i = 0; i < 30; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await Promise.resolve();
        }
    });
};

/** The waiter pauses: the window runs out and the batch is answered. */
const pause = async () => {
    await act(async () => { jest.advanceTimersByTime(ORDER_SYNC_DELAY_MS); });
    await settle();
};

beforeEach(() => {
    jest.useFakeTimers();
    refreshAll.mockReset();
    Object.values(toast).forEach((fn) => fn.mockReset());
    getOrder.mockReset().mockImplementation(async () => ({ data: snapshot() }));
    listOrders.mockReset().mockResolvedValue({ data: [] });
    createOrder.mockReset();
    sendOrderToKitchen.mockReset();
    setOrderAlias.mockReset().mockResolvedValue({ data: {} });
    saveDraftLines.mockReset().mockImplementation(async () => ({
        data: { ...snapshot(server?.lines || []), line_results: [] },
    }));
});

afterEach(async () => {
    if (mounted) await mounted.unmount();
    mounted = null;
    jest.useRealTimers();
});

describe('TB-01: the menu card answers every tap', () => {
    test('a card is not disabled, and reports the tap, while the screen is saving', async () => {
        const onAddProduct = jest.fn();
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);

        await act(async () => {
            root.render(
                <OrderComposer
                    order={snapshot()}
                    items={[]}
                    products={[sopa]}
                    categories={[]}
                    canCompose
                    // `savingItem` is the prop the sheet used to pass (and the
                    // composer used to turn into `disabled` on every card); the
                    // outbox reports its own writing through `saveState`.
                    savingItem
                    saveState="saving"
                    showActions={false}
                    showHeader={false}
                    onAddProduct={onAddProduct}
                    onRemoveProduct={() => {}}
                />
            );
        });

        const card = container.querySelector('[data-testid="mesa-sheet-producto-nombre-p-a"]');
        expect(card.disabled).toBe(false);

        await act(async () => { card.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        expect(onAddProduct).toHaveBeenCalledWith(sopa);

        await act(async () => { root.unmount(); });
        container.remove();
    });

    test('a product that cannot be ordered is the only card that stays disabled', async () => {
        const onAddProduct = jest.fn();
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);

        await act(async () => {
            root.render(
                <OrderComposer
                    order={snapshot()}
                    items={[]}
                    products={[{ ...sopa, is_available: false }]}
                    categories={[]}
                    canCompose
                    hideUnavailable={false}
                    showActions={false}
                    showHeader={false}
                    onAddProduct={onAddProduct}
                    onRemoveProduct={() => {}}
                />
            );
        });

        const card = container.querySelector('[data-testid="mesa-sheet-producto-nombre-p-a"]');
        expect(card.disabled).toBe(true);

        await act(async () => { root.unmount(); });
        container.remove();
    });
});

describe('TB-01: a tap that lands while the account is loading is held, not lost', () => {
    test('the tap is applied as soon as the account in view is known', async () => {
        let release;
        getOrder.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
        const t = table();
        const view = await mountSheet(t);
        server = { id: 'o1', lines: [] };

        await act(async () => { void view.result.current.openSheet(t); });
        expect(view.result.current.openTable.loading).toBe(true);

        await act(async () => { await view.result.current.addProductToAccount(sopa); });
        // Not applied yet (the account's lines are not known) and not thrown away.
        expect(quantityOf(view, 'p-a')).toBe(0);
        // Above all: not turned into a second account for the same table.
        expect(createOrder).not.toHaveBeenCalled();

        await act(async () => { release({ data: snapshot() }); });
        await settle();

        expect(view.result.current.openTable.loading).toBe(false);
        expect(quantityOf(view, 'p-a')).toBe(1);

        await pause();
        expect(createOrder).not.toHaveBeenCalled();
        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        expect(saveDraftLines.mock.calls[0][1]).toHaveLength(1);
        expect(saveDraftLines.mock.calls[0][1][0]).toMatchObject({ product_id: 'p-a', quantity: 1 });
    });

    test('several taps made while loading arrive in the order they were made', async () => {
        let release;
        getOrder.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
        const t = table();
        const view = await mountSheet(t);
        server = { id: 'o1', lines: [] };

        await act(async () => { void view.result.current.openSheet(t); });
        await act(async () => {
            void view.result.current.addProductToAccount(sopa);
            void view.result.current.addProductToAccount(sopa);
            await view.result.current.addProductToAccount(sopa);
        });

        await act(async () => { release({ data: snapshot() }); });
        await settle();

        expect(quantityOf(view, 'p-a')).toBe(3);
        await pause();
        expect(saveDraftLines.mock.calls[0][1]).toEqual([
            { client_line_id: expect.any(String), product_id: 'p-a', quantity: 3 },
        ]);
    });
});

describe('TB-01: a refusal is said out loud', () => {
    test('a tap while the order is being sent to the kitchen is refused with a toast', async () => {
        let releaseSend;
        sendOrderToKitchen.mockImplementation(() => new Promise((resolve) => { releaseSend = resolve; }));
        server = { id: 'o1', lines: [] };
        const t = table();
        const view = await mountSheet(t);
        await act(async () => { await view.result.current.openSheet(t); });

        await act(async () => { void view.result.current.sendCurrentToKitchen('o1'); });
        expect(view.result.current.sendingToKitchen).toBe(true);
        toast.info.mockClear();

        await act(async () => { await view.result.current.addProductToAccount(sopa); });
        expect(toast.info).toHaveBeenCalledWith('Un momento, guardando…', { id: 'sheet-busy' });
        expect(quantityOf(view, 'p-a')).toBe(0);

        await act(async () => { releaseSend({ data: { id: 'o1', status: 'enviado_cocina' } }); });
        await settle();
    });
});
